import { Injectable } from '@nestjs/common';
import { Brackets, EntityManager, Repository } from 'typeorm';
import {
  isPersistenceTransaction,
  type PersistenceTransaction,
} from '../../../database/persistence-transaction';
import { AuditRecord } from '../entities/audit-record.entity';

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

export interface AuditCursor {
  occurredAt: Date;
  id: string;
}

export interface AuditRecordPage {
  items: AuditRecord[];
  hasMore: boolean;
}

export type AuditTransaction = EntityManager | PersistenceTransaction;

export interface AuditRepository {
  // Audit records are append-only; mutation and deletion are intentionally absent.
  append(
    record: AuditRecord,
    transaction?: AuditTransaction,
  ): Promise<AuditRecord>;
  listByOrganization(
    organizationId: string,
    after: AuditCursor | undefined,
    limit: number,
  ): Promise<AuditRecordPage>;
  runInTransaction<T>(
    work: (repository: AuditRepository) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class TypeormAuditRepository implements AuditRepository {
  constructor(private readonly records: Repository<AuditRecord>) {}

  append(
    record: AuditRecord,
    transaction?: AuditTransaction,
  ): Promise<AuditRecord> {
    const manager = transactionManager(transaction);
    const repository = manager?.getRepository(AuditRecord) ?? this.records;
    return repository.save(repository.create(record));
  }

  async listByOrganization(
    organizationId: string,
    after: AuditCursor | undefined,
    limit: number,
  ): Promise<AuditRecordPage> {
    const query = this.records
      .createQueryBuilder('record')
      .where('record.organization_id = :organizationId', { organizationId })
      .orderBy('record.occurred_at', 'DESC')
      .addOrderBy('record.id', 'DESC')
      .take(limit + 1);
    if (after) {
      query.andWhere(
        new Brackets((where) => {
          where
            .where('record.occurred_at < :occurredAt', {
              occurredAt: after.occurredAt,
            })
            .orWhere('record.occurred_at = :occurredAt AND record.id < :id', {
              occurredAt: after.occurredAt,
              id: after.id,
            });
        }),
      );
    }
    const records = await query.getMany();
    return { items: records.slice(0, limit), hasMore: records.length > limit };
  }

  runInTransaction<T>(
    work: (repository: AuditRepository) => Promise<T>,
  ): Promise<T> {
    return this.records.manager.transaction((manager) =>
      work(new TypeormAuditRepository(manager.getRepository(AuditRecord))),
    );
  }
}

@Injectable()
export class InMemoryAuditRepository implements AuditRepository {
  private records: AuditRecord[] = [];

  append(
    record: AuditRecord,
    transaction?: AuditTransaction,
  ): Promise<AuditRecord> {
    const stored = cloneRecord(record);
    this.records.push(stored);
    if (isPersistenceTransaction(transaction))
      transaction.afterRollback(() => {
        const index = this.records.findIndex((item) => item.id === stored.id);
        if (index >= 0) this.records.splice(index, 1);
      });
    return Promise.resolve(cloneRecord(stored));
  }

  listByOrganization(
    organizationId: string,
    after: AuditCursor | undefined,
    limit: number,
  ): Promise<AuditRecordPage> {
    const records = this.records
      .filter((record) => record.organizationId === organizationId)
      .filter((record) => !after || isAfterCursor(record, after))
      .sort(compareAuditRecords);
    return Promise.resolve({
      items: records.slice(0, limit).map(cloneRecord),
      hasMore: records.length > limit,
    });
  }

  async runInTransaction<T>(
    work: (repository: AuditRepository) => Promise<T>,
  ): Promise<T> {
    const transactional = new InMemoryAuditRepository();
    transactional.records = this.records.map(cloneRecord);
    const result = await work(transactional);
    this.records = transactional.records.map(cloneRecord);
    return result;
  }
}

function transactionManager(
  transaction: AuditTransaction | undefined,
): EntityManager | undefined {
  if (!transaction) return undefined;
  if (!isPersistenceTransaction(transaction)) return transaction;
  if (!transaction.manager)
    throw new Error('Audit transaction requires an entity manager');
  return transaction.manager;
}

function isAfterCursor(record: AuditRecord, after: AuditCursor): boolean {
  const timeDifference =
    record.occurredAt.getTime() - after.occurredAt.getTime();
  return timeDifference < 0 || (timeDifference === 0 && record.id < after.id);
}

function compareAuditRecords(left: AuditRecord, right: AuditRecord): number {
  const timeDifference = right.occurredAt.getTime() - left.occurredAt.getTime();
  if (timeDifference !== 0) return timeDifference;
  return right.id.localeCompare(left.id);
}

function cloneRecord(record: AuditRecord): AuditRecord {
  return Object.assign(new AuditRecord(), {
    ...record,
    occurredAt: new Date(record.occurredAt),
    createdAt: record.createdAt ? new Date(record.createdAt) : undefined,
    metadata: structuredClone(record.metadata),
  });
}
