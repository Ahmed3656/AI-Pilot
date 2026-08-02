import { Column, Entity, Index, Unique } from 'typeorm';
import { UtcBaseEntity } from '../../database/entities/utc-base.entity';

@Entity({ name: 'idempotency_records' })
@Unique('uq_idempotency_record_scope', [
  'organizationId',
  'principalId',
  'method',
  'canonicalPath',
  'key',
])
@Index('idx_idempotency_record_expires_at', ['expiresAt'])
export class IdempotencyRecord extends UtcBaseEntity {
  // This uniqueness boundary is the final backstop for all database writers.
  @Column({ name: 'organization_id', type: 'varchar', length: 128 })
  organizationId!: string;

  @Column({ name: 'principal_id', type: 'varchar', length: 128 })
  principalId!: string;

  @Column({ type: 'varchar', length: 8 })
  method!: string;

  @Column({ name: 'canonical_path', type: 'varchar', length: 512 })
  canonicalPath!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  key!: string;

  @Column({ name: 'request_fingerprint', type: 'varchar', length: 64 })
  requestFingerprint!: string;

  @Column({ name: 'response_status', type: 'smallint' })
  responseStatus!: number;

  @Column({ name: 'response_body', type: 'jsonb' })
  responseBody!: unknown;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
