import { Injectable, NotImplementedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedActor } from './types/authenticated-actor.type';
import { JwtPayload } from './types/jwt-payload.type';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issueTokenPair(actor: AuthenticatedActor) {
    const basePayload = {
      sub: actor.id,
      email: actor.email,
      roles: actor.roles,
      permissions: actor.permissions,
    };
    const accessPayload: JwtPayload = { ...basePayload, tokenType: 'access' };
    const refreshPayload: JwtPayload = { ...basePayload, tokenType: 'refresh' };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        expiresIn: this.config.get<string>('auth.accessTtl', '15m') as never,
      }),
      this.jwt.signAsync(refreshPayload, {
        expiresIn: this.config.get<string>('auth.refreshTtl', '7d') as never,
      }),
    ]);
    return { accessToken, refreshToken };
  }

  login(): never {
    // TODO(auth): connect an identity repository and password verifier.
    throw new NotImplementedException(
      'Authentication flow is not implemented yet',
    );
  }

  refresh(): never {
    // TODO(auth): validate rotation state in persistent storage before issuing tokens.
    throw new NotImplementedException(
      'Refresh token flow is not implemented yet',
    );
  }
}
