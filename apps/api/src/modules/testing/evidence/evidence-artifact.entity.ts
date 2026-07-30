import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import type {
  EvidenceDeletionState,
  EvidenceKind,
  EvidenceRedactionState,
  EvidenceRetentionClass,
  EvidenceSensitivity,
} from './evidence.types';

@Entity({ name: 'testing_evidence_artifacts' })
@Index('idx_testing_evidence_tenant_id', ['tenantId', 'id'])
@Index(['tenantId', 'retentionExpiresAt'])
@Index(['tenantId', 'executionId'])
export class TestingEvidenceArtifact extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'varchar', length: 128 })
  tenantId!: string;

  @Column({ name: 'project_id', type: 'varchar', length: 128 })
  projectId!: string;

  @Column({ name: 'campaign_id', type: 'varchar', length: 128 })
  campaignId!: string;

  @Column({ name: 'execution_id', type: 'varchar', length: 128 })
  executionId!: string;

  @Column({ type: 'varchar', length: 40 })
  kind!: EvidenceKind;

  @Column({ name: 'media_type', type: 'varchar', length: 128 })
  mediaType!: string;

  @Column({ name: 'byte_length', type: 'bigint' })
  byteLength!: string;

  @Column({ type: 'varchar', length: 64 })
  sha256!: string;

  @Column({ name: 'captured_at', type: 'timestamptz' })
  capturedAt!: Date;

  @Column({ type: 'varchar', length: 16 })
  sensitivity!: EvidenceSensitivity;

  @Column({ name: 'redaction_state', type: 'varchar', length: 16 })
  redactionState!: EvidenceRedactionState;

  @Column({
    name: 'redaction_version',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  redactionVersion!: string | null;

  @Column({ name: 'retention_class', type: 'varchar', length: 32 })
  retentionClass!: EvidenceRetentionClass;

  @Column({ name: 'retention_expires_at', type: 'timestamptz' })
  retentionExpiresAt!: Date;

  @Column({
    name: 'parent_artifact_id',
    type: 'varchar',
    length: 26,
    nullable: true,
  })
  parentArtifactId!: string | null;

  @Column({ name: 'object_name', type: 'varchar', length: 128, unique: true })
  objectName!: string;

  @Column({ name: 'deletion_state', type: 'varchar', length: 16 })
  deletionState!: EvidenceDeletionState;

  @Column({ name: 'object_deleted_at', type: 'timestamptz', nullable: true })
  objectDeletedAt!: Date | null;
}
