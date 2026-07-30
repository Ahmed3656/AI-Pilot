import { PasswordCredential } from './entities/password-credential.entity';
import { Argon2PasswordHasher } from './password-hasher';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('creates an Argon2id PHC string with the configured memory-hard policy', async () => {
    const password = 'correct horse battery staple';
    const passwordHash = await hasher.hash(password);
    const credential = Object.assign(new PasswordCredential(), {
      algorithm: 'argon2id' as const,
      passwordHash,
      legacySalt: null,
    });

    expect(passwordHash).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[^$]+\$[^$]+$/,
    );
    await expect(hasher.verify(password, credential)).resolves.toBe(true);
    await expect(hasher.verify('incorrect password', credential)).resolves.toBe(
      false,
    );
  });

  it('performs a dummy Argon2id verification for an unknown identity', async () => {
    await expect(
      hasher.verify('unknown identity password', null),
    ).resolves.toBe(false);
  });
});
