import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ulid } from 'ulid';
import { ContractException } from '../../../core/filters/contract-exception';
import { SHOPPING_STORE, ShoppingStore } from '../repositories';
import {
  ControlLeaseStatus,
  ShoppingRunState,
  TERMINAL_RUN_STATES,
  ViewerMode,
} from '../shopping.types';

interface ViewerTokenPayload {
  sub: string;
  jti: string;
  mode: ViewerMode;
  userId: string;
  leaseId: string | null;
  exp: number;
  iat: number;
  nbf: number;
  aud: string;
  iss: string;
}

@Injectable()
export class ViewerTokenService {
  private readonly secret?: string;
  private readonly ttlSeconds: number;
  private readonly publicOrigin: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
    @Inject(SHOPPING_STORE) private readonly store: ShoppingStore,
  ) {
    this.secret = config.get<string>('shopping.viewerSecret') || undefined;
    this.ttlSeconds = Math.min(
      config.get<number>('shopping.viewerTtlSeconds', 900),
      900,
    );
    this.publicOrigin = config
      .get<string>('shopping.publicOrigin', 'http://localhost:8080')
      .replace(/\/$/, '');
  }

  async issue(
    runId: string,
    userId: string,
    mode: ViewerMode,
    leaseId?: string,
  ) {
    if (!this.secret)
      throw new ContractException(
        'DEPENDENCY_UNAVAILABLE',
        503,
        'Viewer token signing is not configured',
      );
    const run = await this.ownedRun(runId, userId);
    if (
      TERMINAL_RUN_STATES.has(run.status) ||
      run.browserExpiresAt <= new Date()
    ) {
      throw new ContractException(
        'CONTROL_NOT_ALLOWED',
        403,
        'Viewer access is not available for this run',
      );
    }
    let leaseExpiresAt: Date | undefined;
    if (mode === ViewerMode.Control) {
      if (!leaseId || run.status !== ShoppingRunState.UserTakeover)
        this.controlDenied();
      const lease = await this.store.findLease(leaseId);
      if (
        !lease ||
        lease.runId !== runId ||
        lease.holderUserId !== userId ||
        lease.status !== ControlLeaseStatus.Active ||
        lease.expiresAt <= new Date()
      )
        this.controlDenied();
      leaseExpiresAt = lease.expiresAt;
    } else if (leaseId) {
      throw new ContractException(
        'VALIDATION_ERROR',
        400,
        'leaseId is permitted only for control tokens',
      );
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const absoluteExpiry = Math.min(
      Date.now() + this.ttlSeconds * 1000,
      run.browserExpiresAt.getTime(),
      leaseExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
    );
    const expiresAt = new Date(absoluteExpiry);
    const token = await this.jwt.signAsync(
      {
        sub: run.id,
        jti: ulid(),
        mode,
        userId,
        leaseId: leaseId ?? null,
        nbf: nowSeconds,
      },
      {
        secret: this.secret,
        algorithm: 'HS256',
        audience: 'dealpilot-viewer',
        issuer: 'dealpilot-api',
        expiresIn: Math.max(
          1,
          Math.floor((absoluteExpiry - Date.now()) / 1000),
        ),
      },
    );
    return {
      token,
      tokenType: 'Bearer' as const,
      mode,
      viewerUrl: `${this.publicOrigin}/viewer/`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async authorize(token: string, expectedRunId?: string) {
    if (!this.secret)
      throw new ContractException(
        'INVALID_VIEWER_TOKEN',
        401,
        'Viewer authorization is unavailable',
      );
    let payload: ViewerTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<ViewerTokenPayload>(token, {
        secret: this.secret,
        algorithms: ['HS256'],
        audience: 'dealpilot-viewer',
        issuer: 'dealpilot-api',
      });
    } catch {
      throw new ContractException(
        'INVALID_VIEWER_TOKEN',
        401,
        'Viewer token is invalid or expired',
      );
    }
    if (expectedRunId && payload.sub !== expectedRunId)
      throw new ContractException(
        'RUN_ACCESS_DENIED',
        403,
        'Viewer token does not authorize this run',
      );
    const run = await this.store.findRun(payload.sub);
    if (
      !run ||
      run.userId !== payload.userId ||
      TERMINAL_RUN_STATES.has(run.status) ||
      run.browserExpiresAt <= new Date()
    )
      this.invalid();
    if (payload.mode === ViewerMode.Control) {
      const lease = payload.leaseId
        ? await this.store.findLease(payload.leaseId)
        : null;
      if (
        !lease ||
        run.status !== ShoppingRunState.UserTakeover ||
        lease.runId !== run.id ||
        lease.holderUserId !== payload.userId ||
        lease.status !== ControlLeaseStatus.Active ||
        lease.expiresAt <= new Date()
      )
        this.invalid();
    }
    return {
      authorized: true as const,
      runId: run.id,
      mode: payload.mode,
      userId: payload.userId,
      leaseId: payload.leaseId,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  }

  private async ownedRun(runId: string, userId: string) {
    const run = await this.store.findRun(runId);
    if (!run || run.userId !== userId)
      throw new ContractException(
        'RUN_NOT_FOUND',
        404,
        'Shopping run not found',
      );
    return run;
  }

  private controlDenied(): never {
    throw new ContractException(
      'CONTROL_NOT_ALLOWED',
      403,
      'An active control lease is required',
    );
  }
  private invalid(): never {
    throw new ContractException(
      'INVALID_VIEWER_TOKEN',
      401,
      'Viewer token is no longer authorized',
    );
  }
}
