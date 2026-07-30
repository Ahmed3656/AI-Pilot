import { Injectable } from '@nestjs/common';

export const AUTHENTICATION_GRANT_PORT = Symbol('AUTHENTICATION_GRANT_PORT');

export type AuthenticationGrantType =
  'local_fixture' | 'external_identity_assertion';

export interface AuthenticationGrantPort {
  resolve(
    grantType: AuthenticationGrantType,
    grant: string,
  ): Promise<string | null>;
}

@Injectable()
export class UnavailableAuthenticationGrantAdapter implements AuthenticationGrantPort {
  resolve(): Promise<null> {
    return Promise.resolve(null);
  }
}

export class TestAuthenticationGrantAdapter implements AuthenticationGrantPort {
  private readonly grants = new Map<string, string>();

  add(grantType: AuthenticationGrantType, grant: string, principalId: string) {
    this.grants.set(`${grantType}:${grant}`, principalId);
  }

  resolve(
    grantType: AuthenticationGrantType,
    grant: string,
  ): Promise<string | null> {
    return Promise.resolve(this.grants.get(`${grantType}:${grant}`) ?? null);
  }
}
