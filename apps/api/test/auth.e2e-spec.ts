import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request, { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApiRouting } from '../src/server';
import { AUTH_CLOCK, AuthClock } from '../src/modules/auth/auth-clock';
import {
  AUTHENTICATION_GRANT_PORT,
  TestAuthenticationGrantAdapter,
} from '../src/modules/auth/authentication-grant.port';
import { AuthService } from '../src/modules/auth/auth.service';
import {
  IDENTITY_NOTIFICATION_PORT,
  TestIdentityNotificationAdapter,
} from '../src/modules/auth/identity-notification.port';

interface SessionBody {
  session: {
    id: string;
    principalId: string;
    status: 'active' | 'revoked' | 'expired';
    rotationFamilyId: string;
    issuedAt: string;
    expiresAt: string;
    revokedAt: string | null;
  };
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    emailVerified: boolean;
  };
}

interface RegistrationBody {
  user: SessionBody['user'];
  verificationRequired: true;
}

class MutableClock implements AuthClock {
  private value = new Date('2026-01-01T00:00:00.000Z');

  now(): Date {
    return new Date(this.value);
  }

  advance(seconds: number): void {
    this.value = new Date(this.value.getTime() + seconds * 1000);
  }
}

describe('Authentication security (e2e)', () => {
  let app: INestApplication;
  let auth: AuthService;
  let clock: MutableClock;
  let notifications: TestIdentityNotificationAdapter;
  let grants: TestAuthenticationGrantAdapter;
  let sequence = 0;

  beforeAll(async () => {
    clock = new MutableClock();
    notifications = new TestIdentityNotificationAdapter();
    grants = new TestAuthenticationGrantAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AUTH_CLOCK)
      .useValue(clock)
      .overrideProvider(IDENTITY_NOTIFICATION_PORT)
      .useValue(notifications)
      .overrideProvider(AUTHENTICATION_GRANT_PORT)
      .useValue(grants)
      .compile();
    app = moduleRef.createNestApplication();
    configureApiRouting(app);
    await app.init();
    auth = app.get(AuthService);
  });

  afterAll(async () => app?.close());

  it('registers without leaking a verification secret and enforces verification', async () => {
    const account = nextAccount('pending');
    const registered = await post('/api/v1/auth/register', account).expect(201);
    const registration = registered.body as RegistrationBody;

    expect(registration).toMatchObject({
      user: {
        email: account.email,
        displayName: account.displayName,
        emailVerified: false,
      },
      verificationRequired: true as const,
    });
    expect(typeof registration.user.id).toBe('string');
    expect(JSON.stringify(registration)).not.toContain(
      latestToken('email_verification'),
    );

    const unverified = await login(account).expect(401);
    expect(stableError(unverified)).toEqual({
      code: 'SESSION_INVALID',
      message: 'Authentication could not be completed',
      status: 401,
      details: [],
    });

    await verifyLatestEmail().expect(200);
    const authenticated = await login(account).expect(200);
    const authenticatedBody = authenticated.body as SessionBody;
    expect(authenticatedBody).toMatchObject({
      session: {
        principalId: registration.user.id,
        status: 'active',
        revokedAt: null,
      },
      user: {
        id: registration.user.id,
        emailVerified: true,
      },
    });
    expect(typeof authenticatedBody.session.id).toBe('string');
    expect(typeof authenticatedBody.session.rotationFamilyId).toBe('string');
    expect(typeof authenticatedBody.accessToken).toBe('string');
    expect(typeof authenticatedBody.refreshToken).toBe('string');
  });

  it('returns the same safe error for an unknown user and a wrong password', async () => {
    const account = await createVerifiedAccount('uniform');
    const unknownPassword = 'unknown-user-password';
    const wrongPassword = 'wrong-user-password';
    const unknown = await post('/api/v1/auth/login', {
      email: nextEmail('missing'),
      password: unknownPassword,
    }).expect(401);
    const wrong = await post('/api/v1/auth/login', {
      email: account.email,
      password: wrongPassword,
    }).expect(401);

    expect(stableError(unknown)).toEqual(stableError(wrong));
    expect(JSON.stringify(unknown.body)).not.toContain(unknownPassword);
    expect(JSON.stringify(wrong.body)).not.toContain(wrongPassword);
  });

  it('rotates an opaque refresh secret and revokes the family on replay', async () => {
    const account = await createVerifiedAccount('rotation');
    const loginResponse = await login(account).expect(200);
    const first = loginResponse.body as SessionBody;
    const rotatedResponse = await post('/api/v1/auth/refresh', {
      sessionId: first.session.id,
      refreshToken: first.refreshToken,
    }).expect(200);
    const rotated = rotatedResponse.body as SessionBody;

    expect(rotated.session.id).toBe(first.session.id);
    expect(rotated.session.rotationFamilyId).toBe(
      first.session.rotationFamilyId,
    );
    expect(rotated.refreshToken).not.toBe(first.refreshToken);

    const replay = await post('/api/v1/auth/refresh', {
      sessionId: first.session.id,
      refreshToken: first.refreshToken,
    }).expect(401);
    expect(stableError(replay).code).toBe('SESSION_INVALID');

    await post('/api/v1/auth/refresh', {
      sessionId: rotated.session.id,
      refreshToken: rotated.refreshToken,
    }).expect(401);
    await post('/api/v1/auth/logout', {})
      .set('Authorization', `Bearer ${rotated.accessToken}`)
      .expect(401);
  });

  it('rejects access/refresh token confusion without echoing either token', async () => {
    const account = await createVerifiedAccount('confusion');
    const response = await login(account).expect(200);
    const session = response.body as SessionBody;

    const accessAsRefresh = await post('/api/v1/auth/refresh', {
      sessionId: session.session.id,
      refreshToken: session.accessToken,
    }).expect(401);
    expect(JSON.stringify(accessAsRefresh.body)).not.toContain(
      session.accessToken,
    );

    const refreshAsAccess = await post('/api/v1/auth/logout', {})
      .set('Authorization', `Bearer ${session.refreshToken}`)
      .expect(401);
    expect(JSON.stringify(refreshAsAccess.body)).not.toContain(
      session.refreshToken,
    );
  });

  it('expires sessions by clock and rejects their refresh secret', async () => {
    const account = await createVerifiedAccount('expiry');
    const response = await login(account).expect(200);
    const session = response.body as SessionBody;

    clock.advance(7 * 24 * 60 * 60 + 1);
    await post('/api/v1/auth/refresh', {
      sessionId: session.session.id,
      refreshToken: session.refreshToken,
    }).expect(401);
  });

  it('expires verification tokens without activating the account', async () => {
    const account = nextAccount('verification-expiry');
    await post('/api/v1/auth/register', account).expect(201);
    const expiredToken = latestToken('email_verification');

    clock.advance(24 * 60 * 60 + 1);
    const expired = await post('/api/v1/auth/email-verification/verify', {
      token: expiredToken,
    }).expect(400);
    expect(stableError(expired).code).toBe('VALIDATION_ERROR');
    await login(account).expect(401);

    const unknownRequest = await post(
      '/api/v1/auth/email-verification/request',
      {
        email: nextEmail('unknown-verification'),
      },
    ).expect(202);
    const knownRequest = await post('/api/v1/auth/email-verification/request', {
      email: account.email,
    }).expect(202);
    expect(unknownRequest.body).toEqual(knownRequest.body);
    await verifyLatestEmail().expect(200);
  });

  it('logs out idempotently at the persistence boundary and revokes refresh', async () => {
    const account = await createVerifiedAccount('logout');
    const response = await login(account).expect(200);
    const session = response.body as SessionBody;

    const logout = await post('/api/v1/auth/logout', {})
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    const logoutBody = logout.body as { session: SessionBody['session'] };
    expect(logoutBody.session.status).toBe('revoked');
    await post('/api/v1/auth/refresh', {
      sessionId: session.session.id,
      refreshToken: session.refreshToken,
    }).expect(401);
  });

  it('applies bounded uniform login throttling with Retry-After', async () => {
    clock.advance(901);
    const email = nextEmail('throttled');
    for (let attempt = 1; attempt < 5; attempt += 1)
      await post('/api/v1/auth/login', {
        email,
        password: 'invalid-password-value',
      }).expect(401);
    const limited = await post('/api/v1/auth/login', {
      email,
      password: 'invalid-password-value',
    }).expect(429);

    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
    expect(stableError(limited)).toEqual({
      code: 'RATE_LIMITED',
      message: 'Authentication attempts are temporarily limited',
      status: 429,
      details: [],
    });
    clock.advance(Number(limited.headers['retry-after']) + 1);
  });

  it('supports hashed recovery tokens and revokes pre-reset sessions', async () => {
    const account = await createVerifiedAccount('recovery');
    const beforeReset = await login(account).expect(200);
    const oldSession = beforeReset.body as SessionBody;

    const unknownRequest = await post(
      '/api/v1/auth/password-recovery/request',
      {
        email: nextEmail('unknown-recovery'),
      },
    ).expect(202);
    const knownRequest = await post('/api/v1/auth/password-recovery/request', {
      email: account.email,
    }).expect(202);
    expect(unknownRequest.body).toEqual(knownRequest.body);
    const recoveryToken = latestToken('password_recovery');
    expect(recoveryToken).not.toBe(account.password);
    const replacementPassword = 'replacement-password-value';
    await post('/api/v1/auth/password-recovery/reset', {
      token: recoveryToken,
      password: replacementPassword,
    }).expect(200);

    await post('/api/v1/auth/refresh', {
      sessionId: oldSession.session.id,
      refreshToken: oldSession.refreshToken,
    }).expect(401);
    await login(account).expect(401);
    await login({ ...account, password: replacementPassword }).expect(200);
  });

  it('exposes the frozen grant/session/managed-revoke contract strictly', async () => {
    const account = await createVerifiedAccount('contract');
    const loggedIn = await login(account).expect(200);
    const target = loggedIn.body as SessionBody;
    grants.add('local_fixture', 'fixture-grant', target.user.id);

    const created = await post(
      '/api/v1/auth/sessions',
      {
        grantType: 'local_fixture',
        grant: 'fixture-grant',
      },
      'contract-create-01',
    ).expect(201);
    const contractSession = created.body as Omit<SessionBody, 'user'>;
    expect(Object.keys(contractSession).sort()).toEqual([
      'accessToken',
      'refreshToken',
      'session',
    ]);

    const refreshed = await post(
      '/api/v1/auth/sessions/refresh',
      {
        sessionId: contractSession.session.id,
        refreshToken: contractSession.refreshToken,
      },
      'contract-refresh-01',
    ).expect(200);
    const refreshedContract = refreshed.body as Omit<SessionBody, 'user'>;
    expect(Object.keys(refreshedContract).sort()).toEqual([
      'accessToken',
      'refreshToken',
      'session',
    ]);

    await post('/api/v1/auth/sessions', {
      grantType: 'local_fixture',
      grant: 'fixture-grant',
    }).expect(400);
    await post(
      '/api/v1/auth/sessions',
      {
        grantType: 'local_fixture',
        grant: 'fixture-grant',
        unexpected: true,
      },
      'contract-strict-01',
    ).expect(400);

    const manager = await auth.issueTokenPair({
      id: target.user.id,
      email: target.user.email,
      roles: [],
      permissions: ['authentication.session.manage'],
    });
    await post(
      `/api/v1/auth/sessions/${target.session.id}/revoke`,
      { reason: 'unauthorized self-service attempt' },
      'contract-revoke-denied-01',
    )
      .set('Authorization', `Bearer ${target.accessToken}`)
      .expect(403);
    const revoked = await post(
      `/api/v1/auth/sessions/${target.session.id}/revoke`,
      { reason: 'security review' },
      'contract-revoke-01',
    )
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    const revokedSession = revoked.body as SessionBody['session'];
    expect(revokedSession).toMatchObject({
      id: target.session.id,
      status: 'revoked',
    });
    expect(typeof revokedSession.revokedAt).toBe('string');
    const repeated = await post(
      `/api/v1/auth/sessions/${target.session.id}/revoke`,
      { reason: 'security review' },
      'contract-revoke-02',
    )
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(repeated.body as SessionBody['session']).toEqual(revokedSession);
  });

  function nextEmail(label: string): string {
    sequence += 1;
    return `${label}-${sequence}@example.test`;
  }

  function nextAccount(label: string) {
    return {
      displayName: `Auth ${label}`,
      email: nextEmail(label),
      password: `valid-${label}-password`,
    };
  }

  async function createVerifiedAccount(label: string) {
    const account = nextAccount(label);
    await post('/api/v1/auth/register', account).expect(201);
    await verifyLatestEmail().expect(200);
    return account;
  }

  function verifyLatestEmail() {
    return post('/api/v1/auth/email-verification/verify', {
      token: latestToken('email_verification'),
    });
  }

  function latestToken(
    kind: 'email_verification' | 'password_recovery',
  ): string {
    const notification = notifications.latest(kind);
    if (!notification) throw new Error(`Missing ${kind} notification`);
    return notification.token;
  }

  function login(account: { email: string; password: string }) {
    return post('/api/v1/auth/login', {
      email: account.email,
      password: account.password,
    });
  }

  function post(path: string, body: object, idempotencyKey?: string) {
    const operation = request(app.getHttpServer() as Server)
      .post(path)
      .send(body);
    return idempotencyKey
      ? operation.set('Idempotency-Key', idempotencyKey)
      : operation;
  }

  function stableError(response: Response) {
    const { error } = response.body as unknown as {
      error: {
        code: unknown;
        message: unknown;
        status: unknown;
        details: unknown;
      };
    };
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details,
    };
  }
});
