import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestingEvidenceArtifact } from './evidence-artifact.entity';
import type { EvidenceArtifactMetadata } from './evidence.types';

export interface EvidenceArtifactRepository {
  find(tenantId: string, id: string): Promise<EvidenceArtifactMetadata | null>;
  save(metadata: EvidenceArtifactMetadata): Promise<EvidenceArtifactMetadata>;
  expired(now: Date): Promise<EvidenceArtifactMetadata[]>;
}

export const EVIDENCE_ARTIFACT_REPOSITORY = Symbol(
  'EVIDENCE_ARTIFACT_REPOSITORY',
);

export class InMemoryEvidenceArtifactRepository implements EvidenceArtifactRepository {
  private readonly artifacts = new Map<string, EvidenceArtifactMetadata>();

  find(tenantId: string, id: string): Promise<EvidenceArtifactMetadata | null> {
    const artifact = this.artifacts.get(this.key(tenantId, id));
    return Promise.resolve(artifact ? clone(artifact) : null);
  }

  save(metadata: EvidenceArtifactMetadata): Promise<EvidenceArtifactMetadata> {
    this.artifacts.set(
      this.key(metadata.tenantId, metadata.id),
      clone(metadata),
    );
    return Promise.resolve(clone(metadata));
  }

  expired(now: Date): Promise<EvidenceArtifactMetadata[]> {
    return Promise.resolve(
      [...this.artifacts.values()]
        .filter(
          (artifact) =>
            artifact.deletionState === 'available' &&
            artifact.retentionExpiresAt.getTime() <= now.getTime(),
        )
        .map(clone),
    );
  }

  private key(tenantId: string, id: string): string {
    return `${tenantId}\u0000${id}`;
  }
}

@Injectable()
export class TypeormEvidenceArtifactRepository implements EvidenceArtifactRepository {
  constructor(
    @InjectRepository(TestingEvidenceArtifact)
    private readonly artifacts: Repository<TestingEvidenceArtifact>,
  ) {}

  async find(
    tenantId: string,
    id: string,
  ): Promise<EvidenceArtifactMetadata | null> {
    const artifact = await this.artifacts.findOne({ where: { tenantId, id } });
    return artifact ? fromEntity(artifact) : null;
  }

  async save(
    metadata: EvidenceArtifactMetadata,
  ): Promise<EvidenceArtifactMetadata> {
    const existing = await this.artifacts.findOne({
      where: { tenantId: metadata.tenantId, id: metadata.id },
    });
    const saved = await this.artifacts.save(
      this.artifacts.create({
        ...(existing ?? {}),
        ...metadata,
        byteLength: String(metadata.byteLength),
        objectName: metadata.id,
        objectDeletedAt: metadata.deletedAt,
      }),
    );
    return fromEntity(saved);
  }

  async expired(now: Date): Promise<EvidenceArtifactMetadata[]> {
    const artifacts = await this.artifacts
      .createQueryBuilder('artifact')
      .where('artifact.deletion_state = :state', { state: 'available' })
      .andWhere('artifact.retention_expires_at <= :now', { now })
      .getMany();
    return artifacts.map(fromEntity);
  }
}

function fromEntity(entity: TestingEvidenceArtifact): EvidenceArtifactMetadata {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    projectId: entity.projectId,
    campaignId: entity.campaignId,
    executionId: entity.executionId,
    kind: entity.kind,
    mediaType: entity.mediaType,
    byteLength: Number(entity.byteLength),
    sha256: entity.sha256,
    capturedAt: entity.capturedAt,
    sensitivity: entity.sensitivity,
    redactionState: entity.redactionState,
    redactionVersion: entity.redactionVersion,
    retentionClass: entity.retentionClass,
    retentionExpiresAt: entity.retentionExpiresAt,
    parentArtifactId: entity.parentArtifactId,
    deletionState: entity.deletionState,
    deletedAt: entity.objectDeletedAt,
  };
}

function clone(metadata: EvidenceArtifactMetadata): EvidenceArtifactMetadata {
  return {
    ...metadata,
    capturedAt: new Date(metadata.capturedAt),
    retentionExpiresAt: new Date(metadata.retentionExpiresAt),
    deletedAt: metadata.deletedAt ? new Date(metadata.deletedAt) : null,
  };
}
