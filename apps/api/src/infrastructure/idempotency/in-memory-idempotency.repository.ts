import {
  IdempotencyExecution,
  IdempotencyExecutionRequest,
  IdempotencyRepository,
  IdempotencyScope,
  JsonValue,
} from './idempotency.types';
import { PersistenceTransactionLifecycle } from '../../database/persistence-transaction';

interface StoredRecord<T extends JsonValue> {
  requestFingerprint: string;
  expiresAt: Date;
  response: { status: number; body: T };
}

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly records = new Map<string, StoredRecord<JsonValue>>();
  private tail: Promise<void> = Promise.resolve();

  async execute<T extends JsonValue>(
    request: IdempotencyExecutionRequest<T>,
  ): Promise<IdempotencyExecution<T>> {
    const key = scopeKey(request.scope);
    const release = await this.acquire();
    try {
      const existing = this.records.get(key);
      if (existing && existing.expiresAt > request.now) {
        if (existing.requestFingerprint !== request.requestFingerprint) {
          return { kind: 'conflict' };
        }
        return {
          kind: 'replayed',
          response: existing.response as { status: number; body: T },
        };
      }

      const transaction = new PersistenceTransactionLifecycle();
      try {
        const response = await request.operation(transaction);
        // Store only after the operation succeeds; failures remain retryable.
        this.records.set(key, {
          requestFingerprint: request.requestFingerprint,
          expiresAt: request.expiresAt,
          response,
        });
        await transaction.commit();
        return { kind: 'executed', response };
      } catch (error) {
        await rollbackWithoutMasking(transaction);
        throw error;
      }
    } finally {
      release();
    }
  }

  private async acquire(): Promise<() => void> {
    // Test-mode mutations serialize globally so rollback journals cannot cross scopes.
    const previous = this.tail;
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    this.tail = current;
    await previous;
    return () => {
      releaseCurrent();
      if (this.tail === current) this.tail = Promise.resolve();
    };
  }
}

async function rollbackWithoutMasking(
  transaction: PersistenceTransactionLifecycle,
): Promise<void> {
  try {
    await transaction.rollback();
  } catch {
    // Preserve the operation failure; rollback participants own recovery visibility.
  }
}

function scopeKey(scope: IdempotencyScope): string {
  const { organizationId, principalId, method, canonicalPath, key } = scope;
  return JSON.stringify([
    organizationId,
    principalId,
    method,
    canonicalPath,
    key,
  ]);
}
