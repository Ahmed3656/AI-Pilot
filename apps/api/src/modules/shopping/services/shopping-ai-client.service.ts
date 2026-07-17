import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import { ContractException } from '../../../core/filters/contract-exception';
import { StructuredLogger } from '../../../core/observability/structured-logger';
import { ShoppingRun } from '../entities';
import { InternalCommandName } from '../shopping.types';

interface AcceptedResponse {
  accepted: true;
  duplicate: boolean;
}

@Injectable()
export class ShoppingAiClientService {
  private readonly baseUrl?: string;
  private readonly internalToken?: string;
  private readonly timeoutMs: number;

  constructor(
    config: ConfigService,
    private readonly logger: StructuredLogger,
  ) {
    this.baseUrl = config.get<string>('shopping.aiBaseUrl') || undefined;
    this.internalToken =
      config.get<string>('shopping.internalToken') || undefined;
    this.timeoutMs = config.get<number>('shopping.aiTimeoutMs', 10_000);
  }

  async createRun(run: ShoppingRun): Promise<void> {
    const response = await this.request<AcceptedResponse & { runId: string }>(
      '/internal/v1/runs',
      run.id,
      {
        runId: run.id,
        query: run.query,
        requestedCategory: run.requestedCategory,
        locale: run.locale,
        market: 'EG',
        currency: 'EGP',
        timezone: 'Africa/Cairo',
        browserExpiresAt: run.browserExpiresAt.toISOString(),
      },
    );
    if (response.runId !== run.id || response.accepted !== true)
      this.rejected('AI create response did not match the run');
  }

  async command(
    run: ShoppingRun,
    name: InternalCommandName,
    payload: Record<string, unknown>,
    id = ulid(),
    issuedAt = new Date().toISOString(),
  ): Promise<string> {
    const command = {
      id,
      runId: run.id,
      name,
      issuedAt,
      payload,
    };
    const response = await this.request<
      AcceptedResponse & { id: string; runId: string }
    >(`/internal/v1/runs/${encodeURIComponent(run.id)}/commands`, id, command);
    if (
      response.id !== id ||
      response.runId !== run.id ||
      response.accepted !== true
    )
      this.rejected('AI command response did not match the command');
    return id;
  }

  private async request<T>(
    path: string,
    idempotencyKey: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    if (!this.baseUrl || !this.internalToken) {
      throw new ContractException(
        'AI_SERVICE_UNAVAILABLE',
        502,
        'AI service is not configured',
      );
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-token': this.internalToken,
            'idempotency-key': idempotencyKey,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
          if (response.status < 500)
            this.rejected(
              `AI service rejected the request with HTTP ${response.status}`,
            );
          throw new Error(`AI service returned HTTP ${response.status}`);
        }
        return (await response.json()) as T;
      } catch (error) {
        if (error instanceof ContractException) throw error;
        lastError = error;
      }
    }
    this.logger.error('shopping.ai.request_failed', {
      path: path.replace(/\?.*$/, ''),
      errorName: lastError instanceof Error ? lastError.name : 'UnknownError',
    });
    throw new ContractException(
      'AI_SERVICE_UNAVAILABLE',
      502,
      'AI service request failed',
    );
  }

  private rejected(message: string): never {
    throw new ContractException('AI_COMMAND_REJECTED', 502, message);
  }
}
