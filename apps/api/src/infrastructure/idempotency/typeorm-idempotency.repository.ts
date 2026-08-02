import { DataSource, EntityManager } from 'typeorm';
import {
  PersistenceTransaction,
  PersistenceTransactionLifecycle,
} from '../../database/persistence-transaction';
import { IdempotencyRecord } from './idempotency-record.entity';
import {
  IdempotencyExecution,
  IdempotencyExecutionRequest,
  IdempotencyRepository,
  JsonValue,
} from './idempotency.types';

export class TypeormIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly dataSource: DataSource) {}

  async execute<T extends JsonValue>(
    request: IdempotencyExecutionRequest<T>,
  ): Promise<IdempotencyExecution<T>> {
    let transaction: PersistenceTransactionLifecycle | undefined;
    let execution: IdempotencyExecution<T>;
    try {
      execution = await this.dataSource.transaction((manager) => {
        transaction = new PersistenceTransactionLifecycle(manager);
        return this.executeInTransaction(manager, transaction, request);
      });
    } catch (error) {
      if (transaction) await rollbackWithoutMasking(transaction);
      throw error;
    }
    if (!transaction) throw new Error('Idempotency transaction did not start');
    await transaction.commit();
    return execution;
  }

  private async executeInTransaction<T extends JsonValue>(
    manager: EntityManager,
    transaction: PersistenceTransaction,
    request: IdempotencyExecutionRequest<T>,
  ): Promise<IdempotencyExecution<T>> {
    const scopeLock = JSON.stringify([
      request.scope.organizationId,
      request.scope.principalId,
      request.scope.method,
      request.scope.canonicalPath,
      request.scope.key,
    ]);
    // Hold this PostgreSQL transaction lock through the business write and replay save.
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [scopeLock],
    );

    const records = manager.getRepository(IdempotencyRecord);
    const existing = await records.findOneBy({ ...request.scope });
    if (existing && existing.expiresAt > request.now) {
      if (existing.requestFingerprint !== request.requestFingerprint) {
        return { kind: 'conflict' };
      }
      return {
        kind: 'replayed',
        response: {
          status: existing.responseStatus,
          body: existing.responseBody as T,
        },
      };
    }

    // The caller must use this manager for durable work so response and write commit together.
    const response = await request.operation(transaction);
    const record = records.create({
      ...(existing ?? {}),
      ...request.scope,
      requestFingerprint: request.requestFingerprint,
      responseStatus: response.status,
      responseBody: response.body,
      expiresAt: request.expiresAt,
    });
    await records.save(record);
    return { kind: 'executed', response };
  }
}

async function rollbackWithoutMasking(
  transaction: PersistenceTransactionLifecycle,
): Promise<void> {
  try {
    await transaction.rollback();
  } catch {
    // Preserve the database or operation failure that caused the rollback.
  }
}
