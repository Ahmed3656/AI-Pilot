import { createHash, randomBytes } from 'node:crypto';
import type {
  ObjectStoragePort,
  StoredObject,
} from '../../../infrastructure/object-storage';
import type { EvidenceArtifactRepository } from './evidence-artifact.repository';
import {
  EVIDENCE_MEDIA_TYPES,
  EvidenceAccessDeniedError,
  EvidenceConflictError,
  EvidenceValidationError,
  type EvidenceAccessGrant,
  type EvidenceArtifactMetadata,
  type EvidenceEventReference,
  type EvidenceUpload,
} from './evidence.types';

interface StoredGrant {
  tenantId: string;
  evidenceId: string;
  expiresAt: Date;
}

export class EvidenceService {
  private readonly grants = new Map<string, StoredGrant>();

  constructor(
    private readonly repository: EvidenceArtifactRepository,
    private readonly storage: ObjectStoragePort,
    private readonly now: () => Date = () => new Date(),
    private readonly tokenFactory: () => string = () =>
      randomBytes(32).toString('base64url'),
    private readonly maxAccessTtlMs = 15 * 60_000,
  ) {}

  async upload(upload: EvidenceUpload): Promise<EvidenceArtifactMetadata> {
    validateUpload(upload);
    const existing = await this.repository.find(upload.tenantId, upload.id);
    if (existing) {
      if (matches(existing, upload)) return existing;
      throw new EvidenceConflictError('Evidence ID is immutable');
    }
    if (upload.parentArtifactId) await this.validateParent(upload);

    const metadata: EvidenceArtifactMetadata = {
      ...withoutBody(upload),
      deletionState: 'available',
      deletedAt: null,
    };
    await this.storage.put({
      tenantId: metadata.tenantId,
      objectName: objectName(metadata.id),
      body: upload.body,
      mediaType: metadata.mediaType,
      byteLength: metadata.byteLength,
      sha256: metadata.sha256,
    });
    return this.repository.save(metadata);
  }

  async grantAccess(
    tenantId: string,
    evidenceId: string,
    ttlMs = 60_000,
  ): Promise<EvidenceAccessGrant> {
    if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > this.maxAccessTtlMs)
      throw new EvidenceValidationError('Evidence access TTL is invalid');
    await this.requireAvailable(tenantId, evidenceId);
    const authorization = this.tokenFactory();
    const expiresAt = new Date(this.now().getTime() + ttlMs);
    this.grants.set(authorization, { tenantId, evidenceId, expiresAt });
    return { authorization, expiresAt };
  }

  async readAuthorized(authorization: string): Promise<StoredObject> {
    const grant = this.grants.get(authorization);
    if (!grant || grant.expiresAt.getTime() <= this.now().getTime())
      throw new EvidenceAccessDeniedError(
        'Evidence authorization is absent or expired',
      );
    const artifact = await this.requireAvailable(
      grant.tenantId,
      grant.evidenceId,
    );
    return this.storage.get(artifact.tenantId, objectName(artifact.id));
  }

  async deleteExpired(now = this.now()): Promise<number> {
    const expired = await this.repository.expired(now);
    for (const artifact of expired) {
      await this.storage.delete(artifact.tenantId, objectName(artifact.id));
      await this.repository.save({
        ...artifact,
        deletionState: 'deleted',
        deletedAt: new Date(now),
      });
    }
    return expired.length;
  }

  eventReference(artifact: EvidenceArtifactMetadata): EvidenceEventReference {
    return { evidenceId: artifact.id };
  }

  private async validateParent(upload: EvidenceUpload): Promise<void> {
    const parent = await this.repository.find(
      upload.tenantId,
      upload.parentArtifactId!,
    );
    if (!parent || parent.deletionState !== 'available')
      throw new EvidenceValidationError('Evidence parent is unavailable');
    if (
      parent.projectId !== upload.projectId ||
      parent.campaignId !== upload.campaignId ||
      parent.executionId !== upload.executionId
    )
      throw new EvidenceValidationError(
        'Evidence parent must share the same execution scope',
      );
    if (upload.redactionState === 'redacted' && parent.redactionState !== 'raw')
      throw new EvidenceValidationError(
        'Redacted evidence must derive from a raw parent',
      );
  }

  private async requireAvailable(
    tenantId: string,
    evidenceId: string,
  ): Promise<EvidenceArtifactMetadata> {
    const artifact = await this.repository.find(tenantId, evidenceId);
    if (!artifact || artifact.deletionState !== 'available')
      throw new EvidenceAccessDeniedError('Evidence is unavailable');
    return artifact;
  }
}

function validateUpload(upload: EvidenceUpload): void {
  if (!isOpaqueId(upload.id, 26))
    throw new EvidenceValidationError('Evidence ID is invalid');
  for (const value of [
    upload.tenantId,
    upload.projectId,
    upload.campaignId,
    upload.executionId,
  ]) {
    if (!isOpaqueId(value))
      throw new EvidenceValidationError('Evidence scope ID is invalid');
  }
  if (!Object.hasOwn(EVIDENCE_MEDIA_TYPES, upload.kind))
    throw new EvidenceValidationError('Evidence kind is unsupported');
  const allowedMediaTypes: readonly string[] =
    EVIDENCE_MEDIA_TYPES[upload.kind];
  if (!allowedMediaTypes.includes(upload.mediaType))
    throw new EvidenceValidationError(
      'Evidence media type is unsupported for this kind',
    );
  if (!Number.isSafeInteger(upload.byteLength) || upload.byteLength < 0)
    throw new EvidenceValidationError('Evidence byte length is invalid');
  if (!/^[a-f0-9]{64}$/.test(upload.sha256))
    throw new EvidenceValidationError(
      'Evidence SHA-256 must be lowercase hexadecimal',
    );
  if (upload.body.byteLength !== upload.byteLength)
    throw new EvidenceValidationError(
      'Evidence byte length does not match uploaded bytes',
    );
  const sha256 = createHash('sha256').update(upload.body).digest('hex');
  if (sha256 !== upload.sha256)
    throw new EvidenceValidationError(
      'Evidence SHA-256 does not match uploaded bytes',
    );
  if (upload.redactionState === 'redacted' && !upload.redactionVersion)
    throw new EvidenceValidationError(
      'Redacted evidence requires a redaction version',
    );
}

function isOpaqueId(value: string, maxLength = 128): boolean {
  return new RegExp(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,${maxLength - 1}}$`).test(
    value,
  );
}

function objectName(id: string): string {
  return id;
}

function withoutBody(upload: EvidenceUpload): Omit<EvidenceUpload, 'body'> {
  const { body, ...metadata } = upload;
  void body;
  return metadata;
}

function matches(
  existing: EvidenceArtifactMetadata,
  upload: EvidenceUpload,
): boolean {
  const candidate = withoutBody(upload);
  return (
    existing.id === candidate.id &&
    existing.tenantId === candidate.tenantId &&
    existing.projectId === candidate.projectId &&
    existing.campaignId === candidate.campaignId &&
    existing.executionId === candidate.executionId &&
    existing.kind === candidate.kind &&
    existing.mediaType === candidate.mediaType &&
    existing.byteLength === candidate.byteLength &&
    existing.sha256 === candidate.sha256 &&
    existing.capturedAt.getTime() === candidate.capturedAt.getTime() &&
    existing.sensitivity === candidate.sensitivity &&
    existing.redactionState === candidate.redactionState &&
    existing.redactionVersion === candidate.redactionVersion &&
    existing.retentionClass === candidate.retentionClass &&
    existing.retentionExpiresAt.getTime() ===
      candidate.retentionExpiresAt.getTime() &&
    existing.parentArtifactId === candidate.parentArtifactId
  );
}
