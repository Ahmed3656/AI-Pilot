import { getMetadataArgsStorage, QueryRunner } from 'typeorm';
import { UtcBaseEntity } from './entities/utc-base.entity';
import { ReconcileFoundationUtcTimestamps1784390100000 } from './migrations/1784390100000-ReconcileFoundationUtcTimestamps';
import { IdempotencyRecord } from '../infrastructure/idempotency/idempotency-record.entity';
import { AuthenticationSession } from '../modules/auth/entities/authentication-session.entity';
import { IdentityToken } from '../modules/auth/entities/identity-token.entity';
import { LoginThrottle } from '../modules/auth/entities/login-throttle.entity';
import { PasswordCredential } from '../modules/auth/entities/password-credential.entity';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { TestingEvidenceArtifact } from '../modules/testing/evidence/evidence-artifact.entity';
import { User } from '../modules/users/entities/user.entity';

const UTC_TABLE_COLUMNS: Record<string, readonly string[]> = {
  users: ['created_at', 'updated_at', 'deleted_at', 'email_verified_at'],
  password_credentials: ['created_at', 'updated_at', 'deleted_at'],
  authentication_sessions: [
    'created_at',
    'updated_at',
    'deleted_at',
    'issued_at',
    'expires_at',
    'revoked_at',
  ],
  authentication_refresh_tokens: [
    'created_at',
    'updated_at',
    'deleted_at',
    'expires_at',
    'rotated_at',
    'revoked_at',
  ],
  identity_one_time_tokens: [
    'created_at',
    'updated_at',
    'deleted_at',
    'expires_at',
    'consumed_at',
    'revoked_at',
  ],
  authentication_login_throttles: [
    'window_started_at',
    'locked_until',
    'updated_at',
  ],
  idempotency_records: ['created_at', 'updated_at', 'deleted_at'],
  testing_evidence_artifacts: ['created_at', 'updated_at', 'deleted_at'],
};

describe('ReconcileFoundationUtcTimestamps migration', () => {
  it('interprets every legacy foundation timestamp as UTC explicitly', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const runner = { query } as unknown as QueryRunner;

    await new ReconcileFoundationUtcTimestamps1784390100000().up(runner);

    expect(query).toHaveBeenCalledTimes(Object.keys(UTC_TABLE_COLUMNS).length);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    for (const [table, columns] of Object.entries(UTC_TABLE_COLUMNS)) {
      expect(sql).toContain(`ALTER TABLE "${table}"`);
      for (const column of columns) {
        expect(sql).toContain(
          `ALTER COLUMN "${column}" TYPE timestamp with time zone USING "${column}" AT TIME ZONE 'UTC'`,
        );
      }
    }
    expect(sql).not.toContain('shopping_');
  });

  it('uses UTC explicitly when reverting to timezone-less columns', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const runner = { query } as unknown as QueryRunner;

    await new ReconcileFoundationUtcTimestamps1784390100000().down(runner);

    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain(
      'TYPE timestamp without time zone USING "created_at" AT TIME ZONE \'UTC\'',
    );
    expect(sql).not.toContain('shopping_');
  });
});

describe('foundation UTC entity metadata', () => {
  it('keeps legacy BaseEntity isolated from UTC foundation entities', () => {
    for (const Entity of [
      User,
      PasswordCredential,
      AuthenticationSession,
      RefreshToken,
      IdentityToken,
      IdempotencyRecord,
      TestingEvidenceArtifact,
    ]) {
      expect(Object.getPrototypeOf(Entity.prototype)).toBe(
        UtcBaseEntity.prototype,
      );
    }

    expect(columnType(UtcBaseEntity, 'createdAt')).toBe('timestamptz');
    expect(columnType(UtcBaseEntity, 'updatedAt')).toBe('timestamptz');
    expect(columnType(UtcBaseEntity, 'deletedAt')).toBe('timestamptz');
    expect(columnType(User, 'emailVerifiedAt')).toBe('timestamptz');
    for (const property of ['issuedAt', 'expiresAt', 'revokedAt']) {
      expect(columnType(AuthenticationSession, property)).toBe('timestamptz');
    }
    for (const property of ['expiresAt', 'rotatedAt', 'revokedAt']) {
      expect(columnType(RefreshToken, property)).toBe('timestamptz');
    }
    for (const property of ['expiresAt', 'consumedAt', 'revokedAt']) {
      expect(columnType(IdentityToken, property)).toBe('timestamptz');
    }
    for (const property of ['windowStartedAt', 'lockedUntil', 'updatedAt']) {
      expect(columnType(LoginThrottle, property)).toBe('timestamptz');
    }
  });
});

function columnType(target: object, propertyName: string): unknown {
  return getMetadataArgsStorage().columns.find(
    (column) =>
      column.target === target && column.propertyName === propertyName,
  )?.options.type;
}
