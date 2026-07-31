import {
  IdempotencyExecution,
  IdempotencyExecutionRequest,
  IdempotencyRepository,
  IdempotencyScope,
  JsonValue,
} from './idempotency.types';

interface StoredRecord<T extends JsonValue> {
  requestFingerprint: string;
  expiresAt: Date;
  response: { status: number; body: T };
}

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly records = new Map<string, StoredRecord<JsonValue>>();
  private readonly tails = new Map<string, Promise<void>>();

  async execute<T extends JsonValue>(
    request: IdempotencyExecutionRequest<T>,
  ): Promise<IdempotencyExecution<T>> {
    const key = scopeKey(request.scope);
    const release = await this.acquire(key);
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

      const response = await request.operation({});
      // Store only after the operation succeeds; failures remain retryable.
      this.records.set(key, {
        requestFingerprint: request.requestFingerprint,
        expiresAt: request.expiresAt,
        response,
      });
      return { kind: 'executed', response };
    } finally {
      release();
    }
  }

  private async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    this.tails.set(key, current);
    await previous;
    return () => {
      releaseCurrent();
      if (this.tails.get(key) === current) {
        this.tails.delete(key);
      }
    };
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
