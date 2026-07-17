import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ulid } from 'ulid';
import { ShoppingStore, SHOPPING_STORE } from '../repositories';
import {
  ShoppingRunState,
  TERMINAL_RUN_STATES,
  ViewerMode,
} from '../shopping.types';

interface ViewerTokenPayload {
  sub: string;
  mode: ViewerMode;
  exp: number;
  iat: number;
  aud: string;
  iss: string;
}

export interface ViewerAuthorization {
  authorized: true;
  runId: string;
  mode: ViewerMode;
  expiresAt: string;
}

@Injectable()
export class ViewerTokenService {
  private readonly secret: string;
  private readonly ttlSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
    @Inject(SHOPPING_STORE) private readonly store: ShoppingStore,
  ) {
    this.secret = config.get<string>(
      'shopping.viewerSecret',
      config.getOrThrow<string>('auth.jwtSecret'),
    );
    this.ttlSeconds = Math.min(
      config.get<number>('shopping.viewerTtlSeconds', 900),
      900,
    );
  }

  async issue(runId: string, mode: ViewerMode) {
    const run = await this.store.findRun(runId);
    if (!run) throw new NotFoundException('Shopping run not found');
    if (TERMINAL_RUN_STATES.has(run.state)) {
      throw new ForbiddenException('Viewer access is no longer available');
    }
    if (
      mode === ViewerMode.Control &&
      run.state !== ShoppingRunState.UserTakeover
    ) {
      throw new ForbiddenException(
        'Control is available only when the run is ready for handoff',
      );
    }
    const expiresInSeconds = this.ttlSeconds;
    const token = await this.jwt.signAsync(
      { sub: run.id, mode, jti: ulid() },
      {
        secret: this.secret,
        audience: 'dealpilot-viewer',
        issuer: 'dealpilot-api',
        expiresIn: expiresInSeconds,
      },
    );
    return {
      token,
      mode,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  async authorize(
    token: string,
    expectedRunId?: string,
  ): Promise<ViewerAuthorization> {
    let payload: ViewerTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<ViewerTokenPayload>(token, {
        secret: this.secret,
        audience: 'dealpilot-viewer',
        issuer: 'dealpilot-api',
      });
    } catch {
      throw new UnauthorizedException('Viewer token is invalid or expired');
    }
    if (expectedRunId && payload.sub !== expectedRunId) {
      throw new ForbiddenException('Viewer token does not match this run');
    }
    const run = await this.store.findRun(payload.sub);
    if (!run) throw new NotFoundException('Shopping run not found');
    if (TERMINAL_RUN_STATES.has(run.state)) {
      throw new ForbiddenException('Viewer access is no longer authorized');
    }
    if (
      payload.mode === ViewerMode.Control &&
      run.state !== ShoppingRunState.UserTakeover
    ) {
      throw new ForbiddenException('Viewer control is no longer authorized');
    }
    return {
      authorized: true,
      runId: payload.sub,
      mode: payload.mode,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  }
}
