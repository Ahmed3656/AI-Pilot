import { InMemoryAuthPersistence } from './auth-persistence.store';

describe('InMemoryAuthPersistence session invariants', () => {
  let store: InMemoryAuthPersistence;
  const issuedAt = new Date('2026-01-01T00:00:00.000Z');
  const expiresAt = new Date('2026-01-08T00:00:00.000Z');

  beforeEach(() => {
    store = new InMemoryAuthPersistence();
  });

  it('rotates in place and commits family revocation before reporting replay', async () => {
    const session = await store.createSession({
      principalId: '01PRINCIPAL000000000000001',
      rotationFamilyId: '01FAMILY00000000000000001',
      issuedAt,
      expiresAt,
      refreshTokenHash: 'a'.repeat(64),
    });

    await expect(
      store.rotateRefreshToken({
        sessionId: session.id,
        refreshTokenHash: 'a'.repeat(64),
        replacementTokenHash: 'b'.repeat(64),
        now: new Date('2026-01-02T00:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      kind: 'rotated',
      session: { id: session.id, rotationFamilyId: session.rotationFamilyId },
    });
    await expect(
      store.rotateRefreshToken({
        sessionId: session.id,
        refreshTokenHash: 'a'.repeat(64),
        replacementTokenHash: 'c'.repeat(64),
        now: new Date('2026-01-02T00:00:01.000Z'),
      }),
    ).resolves.toEqual({ kind: 'reused' });
    await expect(store.findSession(session.id)).resolves.toMatchObject({
      status: 'revoked',
      revocationReason: 'refresh_token_reuse',
    });
    await expect(
      store.rotateRefreshToken({
        sessionId: session.id,
        refreshTokenHash: 'b'.repeat(64),
        replacementTokenHash: 'd'.repeat(64),
        now: new Date('2026-01-02T00:00:02.000Z'),
      }),
    ).resolves.toEqual({ kind: 'reused' });
  });

  it('expires a session by clock and never accepts its refresh token', async () => {
    const session = await store.createSession({
      principalId: '01PRINCIPAL000000000000002',
      rotationFamilyId: '01FAMILY00000000000000002',
      issuedAt,
      expiresAt,
      refreshTokenHash: 'e'.repeat(64),
    });

    await expect(
      store.rotateRefreshToken({
        sessionId: session.id,
        refreshTokenHash: 'e'.repeat(64),
        replacementTokenHash: 'f'.repeat(64),
        now: expiresAt,
      }),
    ).resolves.toEqual({ kind: 'expired' });
    await expect(store.findSession(session.id)).resolves.toMatchObject({
      status: 'expired',
    });
  });

  it('consumes verification and recovery tokens once and revokes sessions on reset', async () => {
    const user = await store.createIdentity({
      email: 'identity@example.test',
      displayName: 'Identity',
      passwordHash: '$argon2id$test',
    });
    await store.createIdentityToken(
      user.id,
      'email_verification',
      '1'.repeat(64),
      expiresAt,
      issuedAt,
    );
    await expect(
      store.verifyEmail('1'.repeat(64), new Date('2026-01-02T00:00:00.000Z')),
    ).resolves.toMatchObject({ status: 'active' });
    await expect(
      store.verifyEmail('1'.repeat(64), new Date('2026-01-02T00:00:01.000Z')),
    ).resolves.toBeNull();

    const session = await store.createSession({
      principalId: user.id,
      rotationFamilyId: '01FAMILY00000000000000003',
      issuedAt,
      expiresAt,
      refreshTokenHash: '2'.repeat(64),
    });
    await store.createIdentityToken(
      user.id,
      'password_recovery',
      '3'.repeat(64),
      expiresAt,
      issuedAt,
    );
    await expect(
      store.resetPassword(
        '3'.repeat(64),
        '$argon2id$replacement',
        new Date('2026-01-02T00:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ id: user.id });
    await expect(store.findSession(session.id)).resolves.toMatchObject({
      status: 'revoked',
      revocationReason: 'password_recovery',
    });
    await expect(
      store.resetPassword(
        '3'.repeat(64),
        '$argon2id$replay',
        new Date('2026-01-02T00:00:01.000Z'),
      ),
    ).resolves.toBeNull();
  });
});
