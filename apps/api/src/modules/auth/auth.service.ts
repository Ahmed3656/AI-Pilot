import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import { ContractException } from '../../core/filters/contract-exception';
import { User } from '../users/entities/user.entity';
import { AUTH_CLOCK, AuthClock } from './auth-clock';
import {
  AUTH_PERSISTENCE,
  AuthPersistence,
  LoginThrottlePolicy,
} from './auth-persistence.store';
import {
  AUTHENTICATION_GRANT_PORT,
  AuthenticationGrantPort,
} from './authentication-grant.port';
import { CreateAuthenticationSessionDto } from './dto/create-authentication-session.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import {
  IDENTITY_NOTIFICATION_PORT,
  IdentityNotificationPort,
} from './identity-notification.port';
import { PASSWORD_HASHER, PasswordHasher } from './password-hasher';
import { AuthenticatedActor } from './types/authenticated-actor.type';
import { JwtPayload } from './types/jwt-payload.type';

export interface IssuedSession {
  session: ReturnType<typeof serializeSession>;
  accessToken: string;
  refreshToken: string;
  user: ReturnType<typeof serializeUser>;
}

@Injectable()
export class AuthService {
  private readonly loginThrottlePolicy: LoginThrottlePolicy;
  private readonly networkThrottlePolicy: LoginThrottlePolicy;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(AUTH_PERSISTENCE)
    private readonly persistence: AuthPersistence,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(IDENTITY_NOTIFICATION_PORT)
    private readonly notifications: IdentityNotificationPort,
    @Inject(AUTHENTICATION_GRANT_PORT)
    private readonly grants: AuthenticationGrantPort,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
  ) {
    this.loginThrottlePolicy = {
      maximumAttempts: config.get<number>('auth.loginMaximumAttempts', 5),
      windowMs: config.get<number>('auth.loginWindowSeconds', 900) * 1000,
      lockMs: config.get<number>('auth.loginLockSeconds', 900) * 1000,
    };
    this.networkThrottlePolicy = {
      ...this.loginThrottlePolicy,
      maximumAttempts: config.get<number>(
        'auth.loginNetworkMaximumAttempts',
        50,
      ),
    };
  }

  async register(dto: RegisterDto) {
    const email = normalizeEmail(dto.email);
    const passwordHash = await this.passwords.hash(dto.password);
    let user: User;
    try {
      user = await this.persistence.createIdentity({
        email,
        displayName: dto.displayName.trim(),
        passwordHash,
      });
    } catch (error) {
      if (!isEmailConflict(error)) throw error;
      throw new ContractException(
        'INVALID_DOMAIN_TRANSITION',
        409,
        'Registration could not be completed',
      );
    }
    await this.issueIdentityToken(user, 'email_verification');
    return {
      user: serializeUser(user),
      verificationRequired: true,
    };
  }

  async login(dto: LoginDto, networkIdentity: string): Promise<IssuedSession> {
    const email = normalizeEmail(dto.email);
    const fingerprints = this.loginFingerprints(email, networkIdentity);
    const throttleScopes = [
      { fingerprint: fingerprints[0], policy: this.loginThrottlePolicy },
      { fingerprint: fingerprints[1], policy: this.networkThrottlePolicy },
    ];
    const now = this.clock.now();
    const retryAfter = maximumRetryAfter(
      await Promise.all(
        throttleScopes.map(({ fingerprint, policy }) =>
          this.persistence.inspectLoginThrottle(fingerprint, now, policy),
        ),
      ),
    );
    if (retryAfter) this.rateLimited(retryAfter);

    const identity =
      await this.persistence.findCredentialIdentityByEmail(email);
    // The dummy Argon2id verification keeps unknown-user and wrong-password work equivalent.
    const passwordValid = await this.passwords.verify(
      dto.password,
      identity?.credential ?? null,
    );
    if (
      !identity ||
      !passwordValid ||
      identity.user.status !== 'active' ||
      !identity.user.emailVerifiedAt
    ) {
      const retry = maximumRetryAfter(
        await Promise.all(
          throttleScopes.map(({ fingerprint, policy }) =>
            this.persistence.recordLoginFailure(fingerprint, now, policy),
          ),
        ),
      );
      if (retry) this.rateLimited(retry);
      this.invalidSession();
    }

    await this.persistence.clearLoginThrottle(fingerprints[0]);
    if (identity.credential.algorithm === 'legacy_scrypt') {
      const upgraded = await this.passwords.hash(dto.password);
      await this.persistence.replacePasswordCredential(
        identity.user.id,
        upgraded,
      );
    }
    return this.issueSession(identity.user, {
      id: identity.user.id,
      email: identity.user.email,
      roles: [],
      permissions: [],
    });
  }

  async createAuthenticationSession(
    dto: CreateAuthenticationSessionDto,
  ): Promise<Omit<IssuedSession, 'user'>> {
    const principalId = await this.grants.resolve(dto.grantType, dto.grant);
    const user = principalId
      ? await this.persistence.findUserById(principalId)
      : null;
    if (!user || user.status !== 'active' || !user.emailVerifiedAt)
      this.invalidSession();
    const issued = await this.issueSession(user, {
      id: user.id,
      email: user.email,
      roles: [],
      permissions: [],
    });
    return withoutUser(issued);
  }

  async refresh(
    dto: RefreshTokenDto,
    includeUser = true,
  ): Promise<IssuedSession | Omit<IssuedSession, 'user'>> {
    const now = this.clock.now();
    const replacement = createRefreshSecret();
    const result = await this.persistence.rotateRefreshToken({
      sessionId: dto.sessionId,
      refreshTokenHash: hashOpaqueToken(dto.refreshToken),
      replacementTokenHash: hashOpaqueToken(replacement),
      now,
    });
    if (result.kind !== 'rotated') this.invalidSession();
    const user = await this.persistence.findUserById(
      result.session.principalId,
    );
    if (!user || user.status !== 'active' || !user.emailVerifiedAt)
      this.invalidSession();
    const accessToken = await this.signAccessToken(
      {
        id: user.id,
        email: user.email,
        roles: [],
        permissions: [],
      },
      result.session.id,
    );
    const issued: IssuedSession = {
      session: serializeSession(result.session, now),
      accessToken,
      refreshToken: replacement,
      user: serializeUser(user),
    };
    return includeUser ? issued : withoutUser(issued);
  }

  async logout(actor: AuthenticatedActor) {
    if (!actor.sessionId) this.invalidSession();
    const session = await this.persistence.revokeSession(
      actor.sessionId,
      'logout',
      this.clock.now(),
    );
    if (!session) this.invalidSession();
    return { session: serializeSession(session, this.clock.now()) };
  }

  async revokeSession(
    actor: AuthenticatedActor,
    sessionId: string,
    reason: string,
  ) {
    if (!actor.permissions.includes('authentication.session.manage'))
      throw new ContractException(
        'PERMISSION_DENIED',
        403,
        'Permission is required',
      );
    const session = await this.persistence.revokeSession(
      sessionId,
      reason,
      this.clock.now(),
    );
    if (!session)
      throw new ContractException(
        'AUTHENTICATION_SESSION_NOT_FOUND',
        404,
        'Authentication session was not found',
      );
    return serializeSession(session, this.clock.now());
  }

  async requestEmailVerification(emailValue: string) {
    const identity = await this.persistence.findCredentialIdentityByEmail(
      normalizeEmail(emailValue),
    );
    if (
      identity &&
      identity.user.status === 'pending_verification' &&
      !identity.user.emailVerifiedAt
    )
      await this.issueIdentityToken(identity.user, 'email_verification');
    return { accepted: true };
  }

  async verifyEmail(token: string) {
    const user = await this.persistence.verifyEmail(
      hashOpaqueToken(token),
      this.clock.now(),
    );
    if (!user) this.invalidIdentityToken();
    return { user: serializeUser(user) };
  }

  async requestPasswordRecovery(emailValue: string) {
    const identity = await this.persistence.findCredentialIdentityByEmail(
      normalizeEmail(emailValue),
    );
    if (
      identity &&
      identity.user.status === 'active' &&
      identity.user.emailVerifiedAt
    )
      await this.issueIdentityToken(identity.user, 'password_recovery');
    return { accepted: true };
  }

  async resetPassword(token: string, password: string) {
    const passwordHash = await this.passwords.hash(password);
    const user = await this.persistence.resetPassword(
      hashOpaqueToken(token),
      passwordHash,
      this.clock.now(),
    );
    if (!user) this.invalidIdentityToken();
    return { reset: true };
  }

  async issueTokenPair(actor: AuthenticatedActor) {
    const user =
      (await this.persistence.findUserById(actor.id)) ??
      Object.assign(new User(), {
        id: actor.id,
        email: actor.email ?? '',
        displayName: actor.email ?? actor.id,
        status: 'active' as const,
        emailVerifiedAt: this.clock.now(),
      });
    return this.issueSession(user, actor);
  }

  async validateAccessSession(
    principalId: string,
    sessionId: string,
  ): Promise<boolean> {
    const [sessionActive, user] = await Promise.all([
      this.persistence.validateActiveSession(
        sessionId,
        principalId,
        this.clock.now(),
      ),
      this.persistence.findUserById(principalId),
    ]);
    return sessionActive && (!user || user.status === 'active');
  }

  private async issueSession(
    user: User,
    actor: AuthenticatedActor,
  ): Promise<IssuedSession> {
    const now = this.clock.now();
    const expiresAt = new Date(
      now.getTime() +
        this.config.get<number>('auth.refreshTtlSeconds', 604_800) * 1000,
    );
    const refreshToken = createRefreshSecret();
    const session = await this.persistence.createSession({
      principalId: actor.id,
      rotationFamilyId: ulid(),
      issuedAt: now,
      expiresAt,
      refreshTokenHash: hashOpaqueToken(refreshToken),
    });
    return {
      session: serializeSession(session, now),
      accessToken: await this.signAccessToken(actor, session.id),
      refreshToken,
      user: serializeUser(user),
    };
  }

  private signAccessToken(
    actor: AuthenticatedActor,
    sessionId: string,
  ): Promise<string> {
    const payload: JwtPayload = {
      sub: actor.id,
      sid: sessionId,
      email: actor.email,
      roles: actor.roles,
      permissions: actor.permissions,
      tokenType: 'access',
    };
    return this.jwt.signAsync(payload, {
      expiresIn: this.config.get<number>('auth.accessTtlSeconds', 900),
    });
  }

  private async issueIdentityToken(
    user: User,
    purpose: 'email_verification' | 'password_recovery',
  ): Promise<void> {
    const now = this.clock.now();
    const token = createRefreshSecret();
    const ttlSeconds =
      purpose === 'email_verification'
        ? this.config.get<number>('auth.verificationTtlSeconds', 86_400)
        : this.config.get<number>('auth.recoveryTtlSeconds', 3600);
    await this.persistence.createIdentityToken(
      user.id,
      purpose,
      hashOpaqueToken(token),
      new Date(now.getTime() + ttlSeconds * 1000),
      now,
    );
    await this.notifications.deliver({
      kind: purpose,
      email: user.email,
      displayName: user.displayName,
      token,
    });
  }

  private loginFingerprints(
    email: string,
    networkIdentity: string,
  ): [string, string] {
    const secret = this.config.getOrThrow<string>('auth.jwtSecret');
    return [
      createHmac('sha256', secret)
        .update('account\0')
        .update(email)
        .digest('hex'),
      createHmac('sha256', secret)
        .update('network\0')
        .update(networkIdentity)
        .digest('hex'),
    ];
  }

  private invalidSession(): never {
    throw new ContractException(
      'SESSION_INVALID',
      401,
      'Authentication could not be completed',
    );
  }

  private invalidIdentityToken(): never {
    throw new ContractException(
      'VALIDATION_ERROR',
      400,
      'The identity token is invalid or expired',
    );
  }

  private rateLimited(retryAfterSeconds: number): never {
    throw new ContractException(
      'RATE_LIMITED',
      429,
      'Authentication attempts are temporarily limited',
      [],
      { retryAfterSeconds },
    );
  }
}

function createRefreshSecret(): string {
  return randomBytes(48).toString('base64url');
}

function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US');
}

function serializeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

function serializeSession(
  session: {
    id: string;
    principalId: string;
    status: 'active' | 'revoked' | 'expired';
    rotationFamilyId: string;
    issuedAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
  },
  now = new Date(),
) {
  const status =
    session.status === 'active' && session.expiresAt.getTime() <= now.getTime()
      ? 'expired'
      : session.status;
  return {
    id: session.id,
    principalId: session.principalId,
    status,
    rotationFamilyId: session.rotationFamilyId,
    issuedAt: session.issuedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    revokedAt: session.revokedAt?.toISOString() ?? null,
  };
}

function withoutUser(session: IssuedSession): Omit<IssuedSession, 'user'> {
  return {
    session: session.session,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  };
}

function isEmailConflict(error: unknown): boolean {
  if (error instanceof Error && error.message === 'AUTH_EMAIL_CONFLICT')
    return true;
  if (!error || typeof error !== 'object' || !('driverError' in error))
    return false;
  const driverError = (error as { driverError?: { code?: unknown } })
    .driverError;
  return driverError?.code === '23505';
}

function maximumRetryAfter(values: Array<number | null>): number | null {
  const retries = values.filter((value): value is number => value !== null);
  return retries.length ? Math.max(...retries) : null;
}
