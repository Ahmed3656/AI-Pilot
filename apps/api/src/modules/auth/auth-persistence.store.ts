import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AuthenticationSession } from './entities/authentication-session.entity';
import {
  IdentityToken,
  IdentityTokenPurpose,
} from './entities/identity-token.entity';
import { LoginThrottle } from './entities/login-throttle.entity';
import { PasswordCredential } from './entities/password-credential.entity';
import { RefreshToken } from './entities/refresh-token.entity';

export const AUTH_PERSISTENCE = Symbol('AUTH_PERSISTENCE');

export interface CredentialIdentity {
  user: User;
  credential: PasswordCredential;
}

export interface CreateIdentityInput {
  email: string;
  displayName: string;
  passwordHash: string;
}

export interface CreateSessionInput {
  principalId: string;
  rotationFamilyId: string;
  issuedAt: Date;
  expiresAt: Date;
  refreshTokenHash: string;
}

export interface RotateRefreshInput {
  sessionId: string;
  refreshTokenHash: string;
  replacementTokenHash: string;
  now: Date;
}

export type RotateRefreshResult =
  | { kind: 'rotated'; session: AuthenticationSession }
  | { kind: 'reused' | 'expired' | 'invalid' };

export interface LoginThrottlePolicy {
  maximumAttempts: number;
  windowMs: number;
  lockMs: number;
}

export interface AuthPersistence {
  createIdentity(input: CreateIdentityInput): Promise<User>;
  findCredentialIdentityByEmail(
    email: string,
  ): Promise<CredentialIdentity | null>;
  findUserById(id: string): Promise<User | null>;
  replacePasswordCredential(
    userId: string,
    passwordHash: string,
  ): Promise<void>;
  createIdentityToken(
    userId: string,
    purpose: IdentityTokenPurpose,
    tokenHash: string,
    expiresAt: Date,
    now: Date,
  ): Promise<void>;
  verifyEmail(tokenHash: string, now: Date): Promise<User | null>;
  resetPassword(
    tokenHash: string,
    passwordHash: string,
    now: Date,
  ): Promise<User | null>;
  createSession(input: CreateSessionInput): Promise<AuthenticationSession>;
  rotateRefreshToken(input: RotateRefreshInput): Promise<RotateRefreshResult>;
  findSession(id: string): Promise<AuthenticationSession | null>;
  validateActiveSession(
    sessionId: string,
    principalId: string,
    now: Date,
  ): Promise<boolean>;
  revokeSession(
    sessionId: string,
    reason: string,
    now: Date,
  ): Promise<AuthenticationSession | null>;
  inspectLoginThrottle(
    fingerprint: string,
    now: Date,
    policy: LoginThrottlePolicy,
  ): Promise<number | null>;
  recordLoginFailure(
    fingerprint: string,
    now: Date,
    policy: LoginThrottlePolicy,
  ): Promise<number | null>;
  clearLoginThrottle(fingerprint: string): Promise<void>;
}

@Injectable()
export class InMemoryAuthPersistence implements AuthPersistence {
  private readonly users = new Map<string, User>();
  private readonly credentials = new Map<string, PasswordCredential>();
  private readonly identityTokens = new Map<string, IdentityToken>();
  private readonly sessions = new Map<string, AuthenticationSession>();
  private readonly refreshTokens = new Map<string, RefreshToken>();
  private readonly throttles = new Map<string, LoginThrottle>();
  private queue = Promise.resolve();

  createIdentity(input: CreateIdentityInput): Promise<User> {
    return this.exclusive(() => {
      if ([...this.users.values()].some((user) => user.email === input.email))
        throw new Error('AUTH_EMAIL_CONFLICT');
      const now = new Date();
      const user = Object.assign(new User(), {
        email: input.email,
        displayName: input.displayName,
        status: 'pending_verification' as const,
        emailVerifiedAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      const credential = Object.assign(new PasswordCredential(), {
        userId: user.id,
        algorithm: 'argon2id' as const,
        passwordHash: input.passwordHash,
        legacySalt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      this.users.set(user.id, user);
      this.credentials.set(user.id, credential);
      return user;
    });
  }

  findCredentialIdentityByEmail(
    email: string,
  ): Promise<CredentialIdentity | null> {
    const user = [...this.users.values()].find((item) => item.email === email);
    const credential = user ? this.credentials.get(user.id) : undefined;
    return Promise.resolve(user && credential ? { user, credential } : null);
  }

  findUserById(id: string): Promise<User | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }

  replacePasswordCredential(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    return this.exclusive(() => {
      const credential = this.credentials.get(userId);
      if (!credential) return;
      credential.algorithm = 'argon2id';
      credential.passwordHash = passwordHash;
      credential.legacySalt = null;
      credential.updatedAt = new Date();
    });
  }

  createIdentityToken(
    userId: string,
    purpose: IdentityTokenPurpose,
    tokenHash: string,
    expiresAt: Date,
    now: Date,
  ): Promise<void> {
    return this.exclusive(() => {
      for (const token of this.identityTokens.values()) {
        if (
          token.userId === userId &&
          token.purpose === purpose &&
          !token.consumedAt &&
          !token.revokedAt
        )
          token.revokedAt = now;
      }
      const token = Object.assign(new IdentityToken(), {
        userId,
        purpose,
        tokenHash,
        expiresAt,
        consumedAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      this.identityTokens.set(tokenHash, token);
    });
  }

  verifyEmail(tokenHash: string, now: Date): Promise<User | null> {
    return this.exclusive(() => {
      const token = this.consumeToken(tokenHash, 'email_verification', now);
      if (!token) return null;
      const user = this.users.get(token.userId);
      if (!user || user.status === 'disabled') return null;
      user.emailVerifiedAt ??= now;
      user.status = 'active';
      user.updatedAt = now;
      return user;
    });
  }

  resetPassword(
    tokenHash: string,
    passwordHash: string,
    now: Date,
  ): Promise<User | null> {
    return this.exclusive(() => {
      const token = this.consumeToken(tokenHash, 'password_recovery', now);
      if (!token) return null;
      const user = this.users.get(token.userId);
      const credential = user ? this.credentials.get(user.id) : undefined;
      if (!user || !credential || user.status === 'disabled') return null;
      credential.algorithm = 'argon2id';
      credential.passwordHash = passwordHash;
      credential.legacySalt = null;
      credential.updatedAt = now;
      this.revokePrincipalSessions(user.id, 'password_recovery', now);
      return user;
    });
  }

  createSession(input: CreateSessionInput): Promise<AuthenticationSession> {
    return this.exclusive(() => {
      const session = Object.assign(new AuthenticationSession(), {
        principalId: input.principalId,
        status: 'active' as const,
        rotationFamilyId: input.rotationFamilyId,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        revokedAt: null,
        revocationReason: null,
        createdAt: input.issuedAt,
        updatedAt: input.issuedAt,
        deletedAt: null,
      });
      const token = Object.assign(new RefreshToken(), {
        sessionId: session.id,
        rotationFamilyId: session.rotationFamilyId,
        tokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        rotatedAt: null,
        revokedAt: null,
        createdAt: input.issuedAt,
        updatedAt: input.issuedAt,
        deletedAt: null,
      });
      this.sessions.set(session.id, session);
      this.refreshTokens.set(token.tokenHash, token);
      return session;
    });
  }

  rotateRefreshToken(input: RotateRefreshInput): Promise<RotateRefreshResult> {
    return this.exclusive(() => {
      const token = this.refreshTokens.get(input.refreshTokenHash);
      const session = this.sessions.get(input.sessionId);
      if (
        !token ||
        !session ||
        token.sessionId !== session.id ||
        token.rotationFamilyId !== session.rotationFamilyId
      )
        return { kind: 'invalid' };
      if (token.rotatedAt || token.revokedAt) {
        this.revokeFamily(
          session.rotationFamilyId,
          'refresh_token_reuse',
          input.now,
        );
        return { kind: 'reused' };
      }
      if (
        session.status !== 'active' ||
        session.expiresAt.getTime() <= input.now.getTime() ||
        token.expiresAt.getTime() <= input.now.getTime()
      ) {
        if (session.status === 'active') {
          session.status = 'expired';
          session.updatedAt = input.now;
        }
        token.revokedAt ??= input.now;
        return { kind: 'expired' };
      }
      token.rotatedAt = input.now;
      token.updatedAt = input.now;
      const replacement = Object.assign(new RefreshToken(), {
        sessionId: session.id,
        rotationFamilyId: session.rotationFamilyId,
        tokenHash: input.replacementTokenHash,
        expiresAt: session.expiresAt,
        rotatedAt: null,
        revokedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      });
      this.refreshTokens.set(replacement.tokenHash, replacement);
      return { kind: 'rotated', session };
    });
  }

  findSession(id: string): Promise<AuthenticationSession | null> {
    return Promise.resolve(this.sessions.get(id) ?? null);
  }

  validateActiveSession(
    sessionId: string,
    principalId: string,
    now: Date,
  ): Promise<boolean> {
    return this.exclusive(() => {
      const session = this.sessions.get(sessionId);
      if (!session || session.principalId !== principalId) return false;
      if (
        session.status === 'active' &&
        session.expiresAt.getTime() <= now.getTime()
      ) {
        session.status = 'expired';
        session.updatedAt = now;
      }
      return session.status === 'active';
    });
  }

  revokeSession(
    sessionId: string,
    reason: string,
    now: Date,
  ): Promise<AuthenticationSession | null> {
    return this.exclusive(() => {
      const session = this.sessions.get(sessionId);
      if (!session) return null;
      this.revokeFamily(session.rotationFamilyId, reason, now);
      return session;
    });
  }

  inspectLoginThrottle(
    fingerprint: string,
    now: Date,
    policy: LoginThrottlePolicy,
  ): Promise<number | null> {
    return this.exclusive(() =>
      inspectThrottle(this.throttles.get(fingerprint), now, policy),
    );
  }

  recordLoginFailure(
    fingerprint: string,
    now: Date,
    policy: LoginThrottlePolicy,
  ): Promise<number | null> {
    return this.exclusive(() => {
      let throttle = this.throttles.get(fingerprint);
      if (
        !throttle ||
        now.getTime() - throttle.windowStartedAt.getTime() >= policy.windowMs
      ) {
        throttle = Object.assign(new LoginThrottle(), {
          fingerprint,
          attemptCount: 0,
          windowStartedAt: now,
          lockedUntil: null,
          updatedAt: now,
        });
        this.throttles.set(fingerprint, throttle);
      }
      throttle.attemptCount += 1;
      throttle.updatedAt = now;
      if (throttle.attemptCount >= policy.maximumAttempts)
        throttle.lockedUntil = new Date(now.getTime() + policy.lockMs);
      return inspectThrottle(throttle, now, policy);
    });
  }

  clearLoginThrottle(fingerprint: string): Promise<void> {
    return this.exclusive(() => {
      this.throttles.delete(fingerprint);
    });
  }

  private consumeToken(
    hash: string,
    purpose: IdentityTokenPurpose,
    now: Date,
  ): IdentityToken | null {
    const token = this.identityTokens.get(hash);
    if (
      !token ||
      token.purpose !== purpose ||
      token.consumedAt ||
      token.revokedAt ||
      token.expiresAt.getTime() <= now.getTime()
    )
      return null;
    token.consumedAt = now;
    token.updatedAt = now;
    return token;
  }

  private revokePrincipalSessions(
    principalId: string,
    reason: string,
    now: Date,
  ): void {
    for (const session of this.sessions.values()) {
      if (session.principalId === principalId)
        this.revokeFamily(session.rotationFamilyId, reason, now);
    }
  }

  private revokeFamily(familyId: string, reason: string, now: Date): void {
    for (const session of this.sessions.values()) {
      if (
        session.rotationFamilyId === familyId &&
        session.status === 'active'
      ) {
        session.status = 'revoked';
        session.revokedAt = now;
        session.revocationReason = reason;
        session.updatedAt = now;
      }
    }
    for (const token of this.refreshTokens.values()) {
      if (token.rotationFamilyId === familyId && !token.revokedAt) {
        token.revokedAt = now;
        token.updatedAt = now;
      }
    }
  }

  private exclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class TypeormAuthPersistence implements AuthPersistence {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: Repository<User>,
    private readonly credentials: Repository<PasswordCredential>,
    private readonly identityTokens: Repository<IdentityToken>,
    private readonly sessions: Repository<AuthenticationSession>,
    private readonly refreshTokens: Repository<RefreshToken>,
    private readonly throttles: Repository<LoginThrottle>,
  ) {}

  createIdentity(input: CreateIdentityInput): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.save(
        manager.create(User, {
          email: input.email,
          displayName: input.displayName,
          status: 'pending_verification',
          emailVerifiedAt: null,
        }),
      );
      await manager.save(
        manager.create(PasswordCredential, {
          userId: user.id,
          algorithm: 'argon2id',
          passwordHash: input.passwordHash,
          legacySalt: null,
        }),
      );
      return user;
    });
  }

  async findCredentialIdentityByEmail(
    email: string,
  ): Promise<CredentialIdentity | null> {
    const user = await this.users
      .createQueryBuilder('identity')
      .leftJoinAndMapOne(
        'identity.passwordCredential',
        PasswordCredential,
        'password_credential',
        'password_credential.user_id = identity.id',
      )
      .where('identity.email = :email', { email })
      .getOne();
    return hasPasswordCredential(user)
      ? { user, credential: user.passwordCredential }
      : null;
  }

  findUserById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  async replacePasswordCredential(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.credentials.update(
      { userId },
      { algorithm: 'argon2id', passwordHash, legacySalt: null },
    );
  }

  createIdentityToken(
    userId: string,
    purpose: IdentityTokenPurpose,
    tokenHash: string,
    expiresAt: Date,
    now: Date,
  ): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      await manager.update(
        IdentityToken,
        { userId, purpose, consumedAt: null, revokedAt: null },
        { revokedAt: now },
      );
      await manager.save(
        manager.create(IdentityToken, {
          userId,
          purpose,
          tokenHash,
          expiresAt,
          consumedAt: null,
          revokedAt: null,
        }),
      );
    });
  }

  verifyEmail(tokenHash: string, now: Date): Promise<User | null> {
    return this.dataSource.transaction(async (manager) => {
      const token = await lockedToken(manager, tokenHash);
      if (!isUsableToken(token, 'email_verification', now)) return null;
      const user = await manager.findOne(User, {
        where: { id: token.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.status === 'disabled') return null;
      token.consumedAt = now;
      user.emailVerifiedAt ??= now;
      user.status = 'active';
      await manager.save([token, user]);
      return user;
    });
  }

  resetPassword(
    tokenHash: string,
    passwordHash: string,
    now: Date,
  ): Promise<User | null> {
    return this.dataSource.transaction(async (manager) => {
      const token = await lockedToken(manager, tokenHash);
      if (!isUsableToken(token, 'password_recovery', now)) return null;
      const user = await manager.findOne(User, {
        where: { id: token.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.status === 'disabled') return null;
      token.consumedAt = now;
      await manager.update(
        PasswordCredential,
        { userId: user.id },
        { algorithm: 'argon2id', passwordHash, legacySalt: null },
      );
      await revokePrincipalSessions(manager, user.id, 'password_recovery', now);
      await manager.save(token);
      return user;
    });
  }

  createSession(input: CreateSessionInput): Promise<AuthenticationSession> {
    return this.dataSource.transaction(async (manager) => {
      const session = await manager.save(
        manager.create(AuthenticationSession, {
          principalId: input.principalId,
          status: 'active',
          rotationFamilyId: input.rotationFamilyId,
          issuedAt: input.issuedAt,
          expiresAt: input.expiresAt,
          revokedAt: null,
          revocationReason: null,
        }),
      );
      await manager.save(
        manager.create(RefreshToken, {
          sessionId: session.id,
          rotationFamilyId: session.rotationFamilyId,
          tokenHash: input.refreshTokenHash,
          expiresAt: input.expiresAt,
          rotatedAt: null,
          revokedAt: null,
        }),
      );
      return session;
    });
  }

  rotateRefreshToken(input: RotateRefreshInput): Promise<RotateRefreshResult> {
    return this.dataSource.transaction(async (manager) => {
      const token = await manager.findOne(RefreshToken, {
        where: { tokenHash: input.refreshTokenHash },
        lock: { mode: 'pessimistic_write' },
      });
      const session = await manager.findOne(AuthenticationSession, {
        where: { id: input.sessionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !token ||
        !session ||
        token.sessionId !== session.id ||
        token.rotationFamilyId !== session.rotationFamilyId
      )
        return { kind: 'invalid' };
      if (token.rotatedAt || token.revokedAt) {
        // Reuse revocation must commit, so the service throws only after this transaction returns.
        await revokeFamily(
          manager,
          session.rotationFamilyId,
          'refresh_token_reuse',
          input.now,
        );
        return { kind: 'reused' };
      }
      if (
        session.status !== 'active' ||
        session.expiresAt.getTime() <= input.now.getTime() ||
        token.expiresAt.getTime() <= input.now.getTime()
      ) {
        if (session.status === 'active') {
          session.status = 'expired';
          await manager.save(session);
        }
        token.revokedAt ??= input.now;
        await manager.save(token);
        return { kind: 'expired' };
      }
      token.rotatedAt = input.now;
      await manager.save(token);
      await manager.save(
        manager.create(RefreshToken, {
          sessionId: session.id,
          rotationFamilyId: session.rotationFamilyId,
          tokenHash: input.replacementTokenHash,
          expiresAt: session.expiresAt,
          rotatedAt: null,
          revokedAt: null,
        }),
      );
      return { kind: 'rotated', session };
    });
  }

  findSession(id: string): Promise<AuthenticationSession | null> {
    return this.sessions.findOneBy({ id });
  }

  validateActiveSession(
    sessionId: string,
    principalId: string,
    now: Date,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const session = await manager.findOne(AuthenticationSession, {
        where: { id: sessionId, principalId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) return false;
      if (
        session.status === 'active' &&
        session.expiresAt.getTime() <= now.getTime()
      ) {
        session.status = 'expired';
        await manager.save(session);
      }
      return session.status === 'active';
    });
  }

  revokeSession(
    sessionId: string,
    reason: string,
    now: Date,
  ): Promise<AuthenticationSession | null> {
    return this.dataSource.transaction(async (manager) => {
      const session = await manager.findOne(AuthenticationSession, {
        where: { id: sessionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) return null;
      await revokeFamily(manager, session.rotationFamilyId, reason, now);
      return manager.findOneBy(AuthenticationSession, { id: session.id });
    });
  }

  inspectLoginThrottle(
    fingerprint: string,
    now: Date,
    policy: LoginThrottlePolicy,
  ): Promise<number | null> {
    return this.dataSource.transaction(async (manager) => {
      const throttle = await manager.findOne(LoginThrottle, {
        where: { fingerprint },
        lock: { mode: 'pessimistic_write' },
      });
      return inspectThrottle(throttle ?? undefined, now, policy);
    });
  }

  recordLoginFailure(
    fingerprint: string,
    now: Date,
    policy: LoginThrottlePolicy,
  ): Promise<number | null> {
    return this.dataSource.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .insert()
        .into(LoginThrottle)
        .values({
          fingerprint,
          attemptCount: 0,
          windowStartedAt: now,
          lockedUntil: null,
          updatedAt: now,
        })
        .orIgnore()
        .execute();
      const throttle = await manager.findOneOrFail(LoginThrottle, {
        where: { fingerprint },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        now.getTime() - throttle.windowStartedAt.getTime() >=
        policy.windowMs
      ) {
        throttle.attemptCount = 0;
        throttle.windowStartedAt = now;
        throttle.lockedUntil = null;
      }
      throttle.attemptCount += 1;
      throttle.updatedAt = now;
      if (throttle.attemptCount >= policy.maximumAttempts)
        throttle.lockedUntil = new Date(now.getTime() + policy.lockMs);
      await manager.save(throttle);
      return inspectThrottle(throttle, now, policy);
    });
  }

  async clearLoginThrottle(fingerprint: string): Promise<void> {
    await this.throttles.delete({ fingerprint });
  }
}

async function lockedToken(
  manager: EntityManager,
  tokenHash: string,
): Promise<IdentityToken | null> {
  return manager.findOne(IdentityToken, {
    where: { tokenHash },
    lock: { mode: 'pessimistic_write' },
  });
}

function isUsableToken(
  token: IdentityToken | null,
  purpose: IdentityTokenPurpose,
  now: Date,
): token is IdentityToken {
  return Boolean(
    token &&
    token.purpose === purpose &&
    !token.consumedAt &&
    !token.revokedAt &&
    token.expiresAt.getTime() > now.getTime(),
  );
}

async function revokePrincipalSessions(
  manager: EntityManager,
  principalId: string,
  reason: string,
  now: Date,
): Promise<void> {
  const sessions = await manager.findBy(AuthenticationSession, {
    principalId,
    status: 'active',
  });
  for (const session of sessions)
    await revokeFamily(manager, session.rotationFamilyId, reason, now);
}

async function revokeFamily(
  manager: EntityManager,
  familyId: string,
  reason: string,
  now: Date,
): Promise<void> {
  await manager.update(
    AuthenticationSession,
    { rotationFamilyId: familyId, status: 'active' },
    { status: 'revoked', revokedAt: now, revocationReason: reason },
  );
  await manager.update(
    RefreshToken,
    { rotationFamilyId: familyId, revokedAt: null },
    { revokedAt: now },
  );
}

function inspectThrottle(
  throttle: LoginThrottle | undefined,
  now: Date,
  policy: LoginThrottlePolicy,
): number | null {
  if (!throttle) return null;
  if (throttle.lockedUntil && throttle.lockedUntil.getTime() > now.getTime())
    return Math.max(
      1,
      Math.ceil((throttle.lockedUntil.getTime() - now.getTime()) / 1000),
    );
  if (now.getTime() - throttle.windowStartedAt.getTime() >= policy.windowMs)
    return null;
  return null;
}

function hasPasswordCredential(
  user: User | null,
): user is User & { passwordCredential: PasswordCredential } {
  return Boolean(
    user &&
    'passwordCredential' in user &&
    user.passwordCredential instanceof PasswordCredential,
  );
}
