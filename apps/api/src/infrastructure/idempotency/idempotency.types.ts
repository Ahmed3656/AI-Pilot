import type { PersistenceTransaction } from '../../database/persistence-transaction';

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface IdempotencyScope {
  organizationId: string;
  principalId: string;
  method: string;
  canonicalPath: string;
  key: string;
}

export interface IdempotencyResponse<T extends JsonValue = JsonValue> {
  status: number;
  body: T;
}

export type IdempotencyTransaction = PersistenceTransaction;

export type IdempotencyExecution<T extends JsonValue> =
  | { kind: 'executed'; response: IdempotencyResponse<T> }
  | { kind: 'replayed'; response: IdempotencyResponse<T> }
  | { kind: 'conflict' };

export interface IdempotencyExecutionRequest<T extends JsonValue> {
  scope: IdempotencyScope;
  requestFingerprint: string;
  now: Date;
  expiresAt: Date;
  operation: (
    transaction: IdempotencyTransaction,
  ) => Promise<IdempotencyResponse<T>>;
}

export interface IdempotencyRepository {
  execute<T extends JsonValue>(
    request: IdempotencyExecutionRequest<T>,
  ): Promise<IdempotencyExecution<T>>;
}

export type IdempotencyClock = () => Date;

export const IDEMPOTENCY_REPOSITORY = Symbol('IDEMPOTENCY_REPOSITORY');
export const IDEMPOTENCY_CLOCK = Symbol('IDEMPOTENCY_CLOCK');
