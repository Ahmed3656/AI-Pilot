import { performance } from 'node:perf_hooks';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { errorFields } from './performance-tracker';
import { StructuredLogger } from './structured-logger';

@Injectable()
export class ControllerPerformanceInterceptor implements NestInterceptor {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: StructuredLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const controller = context.getClass().name;
    const handler = context.getHandler().name;
    const operation = `${controller}.${handler}`;
    const startedAt = performance.now();

    return next.handle().pipe(
      tap(() => {
        const durationMs = performance.now() - startedAt;
        const threshold = this.config.get<number>(
          'observability.slowControllerMs',
          450,
        );
        const fields = {
          layer: 'controller',
          operation,
          durationMs: rounded(durationMs),
          thresholdMs: threshold,
        };
        if (durationMs >= threshold)
          this.logger.warn('controller.operation.slow', fields);
        else this.logger.debug('controller.operation.completed', fields);
      }),
      catchError((error: unknown) => {
        this.logger.error('controller.operation.failed', {
          layer: 'controller',
          operation,
          durationMs: rounded(performance.now() - startedAt),
          ...errorFields(error),
        });
        return throwError(() => error);
      }),
    );
  }
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}
