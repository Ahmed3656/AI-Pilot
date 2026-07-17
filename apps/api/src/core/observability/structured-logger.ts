import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestContextService } from '../request-context/request-context.service';

export type ObservabilityLevel = 'debug' | 'info' | 'warn' | 'error';
export type ObservabilityFields = Record<string, unknown>;

const LEVEL_PRIORITY: Record<ObservabilityLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY =
  /password|passphrase|secret|token|authorization|cookie|recipientName|mobileNumber|governorate|cityOrArea|street|building|floor|apartment|landmark|postalCode/i;

export function redactUrl(value: string): string {
  try {
    const url = new URL(value, 'http://redaction.local');
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return value.replace(
      /([?&](?:password|passphrase|secret|token|authorization|cookie)[^=]*=)[^&]*/gi,
      '$1[REDACTED]',
    );
  }
}

@Injectable()
export class StructuredLogger {
  constructor(
    private readonly config: ConfigService,
    private readonly requestContext: RequestContextService,
  ) {}

  debug(event: string, fields: ObservabilityFields = {}): void {
    this.write('debug', event, fields);
  }

  info(event: string, fields: ObservabilityFields = {}): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields: ObservabilityFields = {}): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields: ObservabilityFields = {}): void {
    this.write('error', event, fields);
  }

  private write(
    level: ObservabilityLevel,
    event: string,
    fields: ObservabilityFields,
  ): void {
    if (!this.config.get<boolean>('observability.enabled', true)) return;
    const configured = this.config.get<ObservabilityLevel>(
      'observability.logLevel',
      'info',
    );
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[configured]) return;

    const record = redactStructuredValue({
      timestamp: new Date().toISOString(),
      level,
      service: this.config.get<string>('app.name', 'AI Pilot API'),
      event,
      requestId: this.requestContext.requestId,
      ...fields,
    });
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }
}

export function redactStructuredValue(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value))
    return value.map((item) => redactStructuredValue(item, seen));

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key)
        ? '[REDACTED]'
        : redactStructuredValue(item, seen),
    ]),
  );
}
