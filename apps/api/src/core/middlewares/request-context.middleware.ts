import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { RequestContextService } from '../request-context/request-context.service';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = sanitizeRequestId(request.header('x-request-id'));
    response.setHeader('x-request-id', requestId);
    this.requestContext.run(
      {
        requestId,
        method: request.method,
        route: request.originalUrl,
        startedAtEpochMs: Date.now(),
        queryCount: 0,
        slowQueryCount: 0,
        queryFingerprints: new Map(),
        reportedNPlusOne: new Set(),
      },
      next,
    );
  }
}

export function sanitizeRequestId(value: string | undefined): string {
  const candidate = value?.trim();
  return candidate &&
    candidate.length <= 64 &&
    /^[A-Za-z0-9._-]+$/.test(candidate)
    ? candidate
    : randomUUID();
}
