import { performance } from 'node:perf_hooks';
import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Observable, catchError, finalize, throwError } from 'rxjs';
import { errorFields } from '../observability/performance-tracker';
import { StructuredLogger } from '../observability/structured-logger';
import { RequestContextService } from '../request-context/request-context.service';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: StructuredLogger,
    private readonly requestContext: RequestContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = performance.now();
    const eventLoopStartedAt = performance.eventLoopUtilization();
    let failure: unknown;
    this.logger.info('http.request.started', {
      method: request.method,
      route: request.originalUrl,
      userAgent: request.header('user-agent'),
    });

    return next.handle().pipe(
      catchError((error: unknown) => {
        failure = error;
        return throwError(() => error);
      }),
      finalize(() => {
        const durationMs = performance.now() - startedAt;
        const eventLoop = performance.eventLoopUtilization(eventLoopStartedAt);
        const threshold = this.config.get<number>(
          'observability.slowRequestMs',
          500,
        );
        const requestContext = this.requestContext.current;
        const statusCode =
          failure instanceof HttpException
            ? failure.getStatus()
            : failure
              ? 500
              : response.statusCode;
        const fields = {
          method: request.method,
          route: request.originalUrl,
          statusCode,
          durationMs: rounded(durationMs),
          eventLoopUtilization: rounded(eventLoop.utilization),
          queryCount: requestContext?.queryCount ?? 0,
          slowQueryCount: requestContext?.slowQueryCount ?? 0,
          ...(failure ? errorFields(failure) : {}),
        };
        if (failure) this.logger.error('http.request.failed', fields);
        else if (durationMs >= threshold)
          this.logger.warn('http.request.slow', {
            ...fields,
            thresholdMs: threshold,
          });
        else this.logger.info('http.request.completed', fields);

        const blockingMs = this.config.get<number>(
          'observability.blockingOperationMs',
          250,
        );
        const blockingUtilization = this.config.get<number>(
          'observability.blockingEventLoopUtilization',
          0.75,
        );
        if (
          durationMs >= blockingMs &&
          eventLoop.utilization >= blockingUtilization
        ) {
          this.logger.warn('http.request.blocking_suspected', {
            ...fields,
            blockingOperationMs: blockingMs,
            blockingEventLoopUtilization: blockingUtilization,
          });
        }
      }),
    );
  }
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}
