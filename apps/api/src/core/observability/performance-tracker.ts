import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestContextService } from '../request-context/request-context.service';
import { StructuredLogger } from './structured-logger';

export type InstrumentedLayer = 'service' | 'repository';

@Injectable()
export class PerformanceTracker {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: StructuredLogger,
    private readonly requestContext: RequestContextService,
  ) {}

  track<T>(layer: InstrumentedLayer, operation: string, callback: () => T): T {
    const startedAt = performance.now();
    try {
      const result = callback();
      if (result instanceof Promise) {
        return Promise.resolve(result).then(
          (value) => {
            this.reportLayer(layer, operation, performance.now() - startedAt);
            return value;
          },
          (error: unknown) => {
            this.reportLayer(
              layer,
              operation,
              performance.now() - startedAt,
              error,
            );
            throw error;
          },
        ) as T;
      }
      this.reportLayer(layer, operation, performance.now() - startedAt);
      return result;
    } catch (error) {
      this.reportLayer(layer, operation, performance.now() - startedAt, error);
      throw error;
    }
  }

  recordDatabaseQuery(query: string, durationMs: number): void {
    const slowQueryMs = this.config.get<number>(
      'observability.slowQueryMs',
      100,
    );
    const fingerprint = fingerprintQuery(query);
    const slow = durationMs >= slowQueryMs;
    const count = this.requestContext.recordQuery(fingerprint, slow);
    const fields = {
      layer: 'database',
      operation: 'query',
      durationMs: rounded(durationMs),
      fingerprint,
      occurrenceInRequest: count,
    };
    if (slow) this.logger.warn('database.query.slow', fields);
    else this.logger.debug('database.query.completed', fields);

    const threshold = this.config.get<number>(
      'observability.nPlusOneThreshold',
      5,
    );
    const context = this.requestContext.current;
    if (
      context &&
      count >= threshold &&
      !context.reportedNPlusOne.has(fingerprint)
    ) {
      context.reportedNPlusOne.add(fingerprint);
      this.logger.warn('database.query.n_plus_one_suspected', {
        fingerprint,
        occurrences: count,
        threshold,
      });
    }
  }

  private reportLayer(
    layer: InstrumentedLayer,
    operation: string,
    durationMs: number,
    error?: unknown,
  ): void {
    const thresholdKey =
      layer === 'service' ? 'slowServiceMs' : 'slowRepositoryMs';
    const fallback = layer === 'service' ? 250 : 120;
    const threshold = this.config.get<number>(
      `observability.${thresholdKey}`,
      fallback,
    );
    const fields = {
      layer,
      operation,
      durationMs: rounded(durationMs),
      thresholdMs: threshold,
      ...(error ? errorFields(error) : {}),
    };
    if (error) this.logger.error(`${layer}.operation.failed`, fields);
    else if (durationMs >= threshold)
      this.logger.warn(`${layer}.operation.slow`, fields);
    else this.logger.debug(`${layer}.operation.completed`, fields);
  }
}

export function fingerprintQuery(query: string): string {
  const normalized = query
    .replace(/'(?:''|[^'])*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export function errorFields(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { errorName: error.name, errorMessage: error.message }
    : { errorMessage: String(error) };
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}
