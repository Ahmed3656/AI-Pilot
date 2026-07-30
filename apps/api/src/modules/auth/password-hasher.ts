import { Injectable } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { promisify } from 'node:util';
import { scrypt, timingSafeEqual } from 'node:crypto';
import { PasswordCredential } from './entities/password-credential.entity';

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(
    password: string,
    credential: PasswordCredential | null,
  ): Promise<boolean>;
}

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$X/9bRoaR2YKvIdmbDzhnFw$8O+yMXMYuDxr+lFru7yS0QJOWpE04dY+TxznnFwUEyU';

const derive = promisify(scrypt);

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(
    password: string,
    credential: PasswordCredential | null,
  ): Promise<boolean> {
    if (!credential)
      return verify(DUMMY_PASSWORD_HASH, password, ARGON2_OPTIONS).then(
        () => false,
        () => false,
      );
    if (credential.algorithm === 'argon2id')
      return verify(credential.passwordHash, password, ARGON2_OPTIONS).catch(
        () => false,
      );
    if (!credential.legacySalt) return false;
    const actual = Buffer.from(
      (await derive(password, credential.legacySalt, 64)) as Buffer,
    );
    const expected = Buffer.from(credential.passwordHash, 'hex');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
