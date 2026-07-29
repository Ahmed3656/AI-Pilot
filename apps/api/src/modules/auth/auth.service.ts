import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { promisify } from 'node:util';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { ContractException } from '../../core/filters/contract-exception';
import { AUTH_ACCOUNT_STORE, AuthAccountStore } from './auth-account.store';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthAccount } from './entities/auth-account.entity';
import { AuthenticatedActor } from './types/authenticated-actor.type';
import { JwtPayload } from './types/jwt-payload.type';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(AUTH_ACCOUNT_STORE) private readonly accounts: AuthAccountStore,
  ) {}

  async issueTokenPair(actor: AuthenticatedActor, refreshVersion?: number) {
    const basePayload = {
      sub: actor.id,
      email: actor.email,
      roles: actor.roles,
      permissions: actor.permissions,
    };
    const accessPayload: JwtPayload = { ...basePayload, tokenType: 'access' };
    const refreshPayload: JwtPayload = {
      ...basePayload,
      tokenType: 'refresh',
      ...(refreshVersion === undefined ? {} : { refreshVersion }),
    };
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

  async register(dto: RegisterDto) {
    const email = normalizeEmail(dto.email);
    if (await this.accounts.findByEmail(email)) this.invalidCredentials();
    const passwordSalt = randomBytes(16).toString('hex');
    const passwordHash = await passwordDigest(dto.password, passwordSalt);
    const account = await this.accounts.save({
      email,
      displayName: dto.displayName.trim(),
      passwordSalt,
      passwordHash,
      refreshVersion: 0,
    });
    return this.session(account);
  }

  async login(dto: LoginDto) {
    const account = await this.accounts.findByEmail(normalizeEmail(dto.email));
    if (!account) this.invalidCredentials();
    const actual = Buffer.from(
      await passwordDigest(dto.password, account.passwordSalt),
      'hex',
    );
    const expected = Buffer.from(account.passwordHash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      this.invalidCredentials();
    account.refreshVersion += 1;
    await this.accounts.save(account);
    return this.session(account);
  }

  async refresh(dto: RefreshTokenDto) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(dto.refreshToken);
    } catch {
      this.invalidCredentials();
    }
    if (payload.tokenType !== 'refresh') this.invalidCredentials();
    const account = await this.accounts.findById(payload.sub);
    if (!account || payload.refreshVersion !== account.refreshVersion)
      this.invalidCredentials();
    account.refreshVersion += 1;
    await this.accounts.save(account);
    return this.session(account);
  }

  private async session(account: AuthAccount) {
    const tokens = await this.issueTokenPair(
      { id: account.id, email: account.email, roles: [], permissions: [] },
      account.refreshVersion,
    );
    return {
      ...tokens,
      user: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
      },
    };
  }

  private invalidCredentials(): never {
    throw new ContractException(
      'UNAUTHENTICATED',
      401,
      'Email or password is invalid',
    );
  }
}

const derive = promisify(scrypt);

async function passwordDigest(password: string, salt: string): Promise<string> {
  return ((await derive(password, salt, 64)) as Buffer).toString('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US');
}
