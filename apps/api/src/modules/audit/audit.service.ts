import { Inject, Injectable } from '@nestjs/common';
import { AuditAction } from './audit-actions';
import { AuditMetadata, validateAuditMetadata } from './audit-metadata';
import {
  AuditActorType,
  AuditOutcome,
  AuditRecord,
} from './entities/audit-record.entity';
import {
  AUDIT_REPOSITORY,
  AuditCursor,
  AuditRepository,
  AuditTransaction,
} from './repositories/audit.repository';

export interface AppendAuditRecordInput {
  organizationId: string;
  actorType: AuditActorType;
  actorId: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  requestId: string;
  metadata?: AuditMetadata;
  policyVersion?: string | null;
  statementVersion?: string | null;
  outcome: AuditOutcome;
  occurredAt?: Date;
}

export interface AuditListInput {
  organizationId: string;
  after?: string;
  limit?: number;
}

export interface AuditListResult {
  items: AuditRecord[];
  nextCursor: string | null;
}

export interface AtomicAuditWriter {
  append(input: AppendAuditRecordInput): Promise<AuditRecord>;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly records: AuditRepository,
  ) {}

  async append(
    input: AppendAuditRecordInput,
    transaction?: AuditTransaction,
  ): Promise<AuditRecord> {
    return this.records.append(this.newRecord(input), transaction);
  }

  async appendRequired(
    input: AppendAuditRecordInput,
    transaction?: AuditTransaction,
  ): Promise<AuditRecord> {
    // Propagate persistence failures so the caller's privileged transaction rolls back.
    return this.append(input, transaction);
  }

  async runAtomically<T>(
    work: (audit: AtomicAuditWriter) => Promise<T>,
  ): Promise<T> {
    return this.records.runInTransaction((repository) =>
      work({ append: (input) => repository.append(this.newRecord(input)) }),
    );
  }

  async listForOrganization(input: AuditListInput): Promise<AuditListResult> {
    const limit = Math.max(1, Math.min(100, input.limit ?? 50));
    const after = input.after
      ? decodeCursor(input.after, input.organizationId)
      : undefined;
    const page = await this.records.listByOrganization(
      input.organizationId,
      after,
      limit,
    );
    const last = page.items.at(-1);
    return {
      items: page.items,
      nextCursor:
        page.hasMore && last
          ? encodeCursor(input.organizationId, last.occurredAt, last.id)
          : null,
    };
  }

  private newRecord(input: AppendAuditRecordInput): AuditRecord {
    const occurredAt = input.occurredAt ?? new Date();
    if (Number.isNaN(occurredAt.getTime()))
      throw new Error('AUDIT_TIME_INVALID');
    assertRequired(input.organizationId, 'organizationId');
    assertRequired(input.actorId, 'actorId');
    assertRequired(input.targetType, 'targetType');
    assertRequired(input.targetId, 'targetId');
    assertRequired(input.requestId, 'requestId');
    if (input.requestId.length > 64)
      throw new Error('AUDIT_REQUEST_ID_INVALID');
    if (input.policyVersion && input.policyVersion.length > 128)
      throw new Error('AUDIT_POLICY_VERSION_INVALID');
    if (input.statementVersion && input.statementVersion.length > 128)
      throw new Error('AUDIT_STATEMENT_VERSION_INVALID');

    return Object.assign(new AuditRecord(), {
      organizationId: input.organizationId,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      occurredAt,
      requestId: input.requestId,
      metadata: validateAuditMetadata(input.metadata ?? {}),
      policyVersion: input.policyVersion ?? null,
      statementVersion: input.statementVersion ?? null,
      outcome: input.outcome,
    });
  }
}

function assertRequired(value: string, field: string): void {
  if (!value.trim()) throw new Error(`AUDIT_${field.toUpperCase()}_REQUIRED`);
}

interface AuditCursorPayload {
  organizationId: string;
  occurredAt: string;
  id: string;
}

function encodeCursor(
  organizationId: string,
  occurredAt: Date,
  id: string,
): string {
  return Buffer.from(
    JSON.stringify({
      organizationId,
      occurredAt: occurredAt.toISOString(),
      id,
    }),
  ).toString('base64url');
}

function decodeCursor(value: string, organizationId: string): AuditCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new Error('AUDIT_CURSOR_INVALID');
  }
  if (!isAuditCursorPayload(decoded)) throw new Error('AUDIT_CURSOR_INVALID');
  const payload = decoded;
  const occurredAt = new Date(payload.occurredAt);
  if (
    payload.organizationId !== organizationId ||
    !payload.id ||
    Number.isNaN(occurredAt.getTime())
  ) {
    throw new Error('AUDIT_CURSOR_INVALID');
  }
  return { occurredAt, id: payload.id };
}

function isAuditCursorPayload(value: unknown): value is AuditCursorPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'organizationId' in value &&
    typeof value.organizationId === 'string' &&
    'occurredAt' in value &&
    typeof value.occurredAt === 'string' &&
    'id' in value &&
    typeof value.id === 'string'
  );
}
