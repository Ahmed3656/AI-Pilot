import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StructuredLogger } from '../../../core/observability/structured-logger';
import { ShoppingRun } from '../entities';

interface AiRunResponse {
  id: string;
}

@Injectable()
export class ShoppingAiClientService {
  private readonly baseUrl?: string;
  private readonly internalToken: string;

  constructor(
    config: ConfigService,
    private readonly logger: StructuredLogger,
  ) {
    this.baseUrl = config.get<string>('shopping.aiBaseUrl') || undefined;
    this.internalToken = config.get<string>(
      'shopping.internalToken',
      'local-internal-token-change-before-production',
    );
  }

  async createRun(run: ShoppingRun): Promise<string | null> {
    if (!this.baseUrl) return null;
    const response = await this.request<AiRunResponse>('/internal/v1/runs', {
      runId: run.id,
      category: run.category,
      query: run.query,
      market: 'EG',
      currency: 'EGP',
    });
    return response.id;
  }

  async command(
    run: ShoppingRun,
    type: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    if (!this.baseUrl) return;
    if (!run.aiRunId) {
      throw new BadGatewayException('AI run has not been initialized');
    }
    await this.request(
      `/internal/v1/runs/${encodeURIComponent(run.aiRunId)}/commands`,
      {
        type,
        ...payload,
      },
    );
  }

  private async request<T = unknown>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': this.internalToken,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(`AI service returned HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      this.logger.error('shopping.ai.request_failed', {
        path,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new BadGatewayException('AI service request failed');
    }
  }
}
