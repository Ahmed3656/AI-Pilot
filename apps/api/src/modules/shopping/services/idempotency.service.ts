import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ContractException } from '../../../core/filters/contract-exception';
import { SHOPPING_STORE, ShoppingStore } from '../repositories';

@Injectable()
export class IdempotencyService {
  constructor(@Inject(SHOPPING_STORE) private readonly store: ShoppingStore) {}

  async execute<T extends Record<string, unknown>>(
    principalId: string,
    method: string,
    path: string,
    key: string | undefined,
    body: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (
      !key ||
      key.length < 8 ||
      key.length > 128 ||
      !/^[\x20-\x7E]+$/.test(key)
    ) {
      throw new ContractException(
        'VALIDATION_ERROR',
        400,
        'Idempotency-Key must contain 8-128 printable ASCII characters',
      );
    }
    const requestHash = createHash('sha256')
      .update(stableStringify(body))
      .digest('hex');
    const scope = { principalId, method, path, key };
    const existing = await this.store.findIdempotency(scope);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ContractException(
          'IDEMPOTENCY_KEY_REUSED',
          409,
          'Idempotency-Key was reused with a different request',
        );
      }
      return existing.response as T;
    }
    const response = await operation();
    await this.store.saveIdempotency({
      ...scope,
      requestHash,
      response,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    return response;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
