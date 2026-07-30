import { Inject, Injectable } from '@nestjs/common';
import { ContractException } from '../../core/filters/contract-exception';
import { canonicalRequestFingerprint } from './canonical-request-fingerprint';
import {
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_REPOSITORY,
  IdempotencyClock,
  IdempotencyRepository,
  IdempotencyResponse,
  IdempotencyScope,
  IdempotencyTransaction,
  JsonValue,
} from './idempotency.types';

const RETENTION_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class IdempotencyService {
  constructor(
    @Inject(IDEMPOTENCY_REPOSITORY)
    private readonly repository: IdempotencyRepository,
    @Inject(IDEMPOTENCY_CLOCK) private readonly clock: IdempotencyClock,
  ) {}

  async execute<T extends JsonValue>(
    scope: IdempotencyScope,
    body: unknown,
    operation: (
      transaction: IdempotencyTransaction,
    ) => Promise<IdempotencyResponse<T>>,
  ): Promise<IdempotencyResponse<T>> {
    this.assertScope(scope);
    const now = this.clock();
    const execution = await this.repository.execute({
      scope,
      requestFingerprint: canonicalRequestFingerprint(body),
      now,
      expiresAt: new Date(now.getTime() + RETENTION_MS),
      operation: async (transaction) => {
        const response = await operation(transaction);
        this.assertResponse(response);
        return response;
      },
    });
    if (execution.kind === 'conflict') {
      throw new ContractException(
        'IDEMPOTENCY_KEY_REUSED',
        409,
        'Idempotency-Key was reused with a different request',
      );
    }
    return execution.response;
  }

  private assertScope(scope: IdempotencyScope): void {
    if (
      !scope.key ||
      scope.key.length < 8 ||
      scope.key.length > 128 ||
      !/^[\x20-\x7E]+$/.test(scope.key)
    ) {
      throw new ContractException(
        'VALIDATION_ERROR',
        400,
        'Idempotency-Key must contain 8-128 printable ASCII characters',
      );
    }
    if (
      !scope.organizationId ||
      !scope.principalId ||
      !scope.method ||
      !scope.canonicalPath
    ) {
      throw new ContractException(
        'VALIDATION_ERROR',
        400,
        'Idempotency scope is incomplete',
      );
    }
  }

  private assertResponse(response: IdempotencyResponse<JsonValue>): void {
    if (
      !Number.isInteger(response.status) ||
      response.status < 100 ||
      response.status > 599
    ) {
      throw new TypeError(
        'Idempotency response status must be a valid HTTP status',
      );
    }
  }
}
