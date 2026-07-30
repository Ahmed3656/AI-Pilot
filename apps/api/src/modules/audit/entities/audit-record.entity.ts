import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { AuditMetadata } from '../audit-metadata';

export const AUDIT_ACTOR_TYPES = ['principal', 'service', 'system'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const AUDIT_OUTCOMES = ['succeeded', 'failed', 'denied'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

@Entity({ name: 'audit_records' })
@Index('idx_audit_records_organization_occurred_id', [
  'organizationId',
  'occurredAt',
  'id',
])
export class AuditRecord {
  @PrimaryColumn('varchar', { length: 26 })
  id: string = ulid();

  @Column({ name: 'organization_id', type: 'varchar', length: 128 })
  organizationId!: string;

  @Column({ name: 'actor_type', type: 'varchar', length: 32 })
  actorType!: AuditActorType;

  @Column({ name: 'actor_id', type: 'varchar', length: 128 })
  actorId!: string;

  @Column({ type: 'varchar', length: 128 })
  action!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 128 })
  targetType!: string;

  @Column({ name: 'target_id', type: 'varchar', length: 128 })
  targetId!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'request_id', type: 'varchar', length: 64 })
  requestId!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: AuditMetadata;

  @Column({
    name: 'policy_version',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  policyVersion!: string | null;

  @Column({
    name: 'statement_version',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  statementVersion!: string | null;

  @Column({ type: 'varchar', length: 16 })
  outcome!: AuditOutcome;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
