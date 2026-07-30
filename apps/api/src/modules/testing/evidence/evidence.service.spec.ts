import { createHash } from 'node:crypto';
import { InMemoryObjectStorageAdapter } from '../../../infrastructure/object-storage';
import { InMemoryEvidenceArtifactRepository } from './evidence-artifact.repository';
import {
  EvidenceAccessDeniedError,
  EvidenceValidationError,
  type EvidenceUpload,
} from './evidence.types';
import { EvidenceService } from './evidence.service';

const ids = {
  artifact: '01J00000000000000000000000',
  child: '01J00000000000000000000001',
  project: 'project-1',
  campaign: 'campaign-1',
  execution: 'execution-1',
};

describe('EvidenceService', () => {
  let now: Date;
  let storage: InMemoryObjectStorageAdapter;
  let repository: InMemoryEvidenceArtifactRepository;
  let service: EvidenceService;

  beforeEach(() => {
    now = new Date('2026-07-29T12:00:00.000Z');
    storage = new InMemoryObjectStorageAdapter();
    repository = new InMemoryEvidenceArtifactRepository();
    service = new EvidenceService(
      repository,
      storage,
      () => now,
      () => 'access-token',
    );
  });

  it('hashes bytes before accepting metadata and stores bytes outside the event reference', async () => {
    const upload = evidenceUpload();
    const artifact = await service.upload(upload);

    expect(artifact.sha256).toBe(digest(upload.body));
    await expect(storage.get('tenant-a', artifact.id)).resolves.toMatchObject({
      body: upload.body,
      sha256: digest(upload.body),
    });
    expect(service.eventReference(artifact)).toEqual({
      evidenceId: artifact.id,
    });
    expect(JSON.stringify(service.eventReference(artifact))).not.toContain(
      'evidence bytes',
    );
  });

  it('rejects unsupported evidence kinds, media types, and byte/hash mismatches', async () => {
    await expect(
      service.upload({
        ...evidenceUpload(),
        kind: 'screenshot',
        mediaType: 'text/plain',
      }),
    ).rejects.toBeInstanceOf(EvidenceValidationError);
    await expect(
      service.upload({ ...evidenceUpload(), byteLength: 1 }),
    ).rejects.toThrow('byte length');
    await expect(
      service.upload({ ...evidenceUpload(), sha256: '0'.repeat(64) }),
    ).rejects.toThrow('SHA-256');
  });

  it('does not allow a tenant to mint access to another tenant evidence', async () => {
    const artifact = await service.upload(evidenceUpload());

    await expect(
      service.grantAccess('tenant-b', artifact.id),
    ).rejects.toBeInstanceOf(EvidenceAccessDeniedError);
    await expect(storage.get('tenant-b', artifact.id)).rejects.toThrow(
      'not found',
    );
  });

  it('expires scoped evidence authorization', async () => {
    await service.upload(evidenceUpload());
    const grant = await service.grantAccess('tenant-a', ids.artifact, 1_000);

    now = new Date(now.getTime() + 1_000);
    await expect(
      service.readAuthorized(grant.authorization),
    ).rejects.toBeInstanceOf(EvidenceAccessDeniedError);
  });

  it('preserves raw-to-redacted derivation relationships in the same execution', async () => {
    const raw = await service.upload(
      evidenceUpload({
        sensitivity: 'sensitive',
        redactionState: 'raw',
        redactionVersion: null,
        retentionClass: 'sensitive_raw',
      }),
    );
    const redacted = await service.upload(
      evidenceUpload({
        id: ids.child,
        parentArtifactId: raw.id,
        redactionState: 'redacted',
        redactionVersion: 'redaction-v1',
      }),
    );

    expect(redacted.parentArtifactId).toBe(raw.id);
    await expect(
      service.upload(
        evidenceUpload({
          id: '01J00000000000000000000002',
          parentArtifactId: raw.id,
          redactionState: 'redacted',
          redactionVersion: 'redaction-v1',
          executionId: 'execution-2',
        }),
      ),
    ).rejects.toThrow('same execution scope');
  });

  it('tombstones expired evidence and denies an authorization minted before deletion', async () => {
    const artifact = await service.upload(
      evidenceUpload({ retentionExpiresAt: new Date(now.getTime() + 1_000) }),
    );
    const grant = await service.grantAccess('tenant-a', artifact.id);

    now = new Date(now.getTime() + 1_000);
    await expect(service.deleteExpired()).resolves.toBe(1);
    await expect(
      service.readAuthorized(grant.authorization),
    ).rejects.toBeInstanceOf(EvidenceAccessDeniedError);
    await expect(
      repository.find('tenant-a', artifact.id),
    ).resolves.toMatchObject({
      deletionState: 'deleted',
      sha256: artifact.sha256,
    });
  });

  it('keeps large artifacts out of events', async () => {
    const artifact = await service.upload(
      evidenceUpload({ body: Buffer.alloc(1_048_577, 7) }),
    );
    const event = service.eventReference(artifact);

    expect(event).toEqual({ evidenceId: artifact.id });
    expect(Object.values(event)).not.toContainEqual(expect.any(Buffer));
    expect(JSON.stringify(event).length).toBeLessThan(100);
  });
});

function evidenceUpload(
  overrides: Partial<EvidenceUpload> = {},
): EvidenceUpload {
  const body = overrides.body ?? Buffer.from('evidence bytes');
  return {
    id: ids.artifact,
    tenantId: 'tenant-a',
    projectId: ids.project,
    campaignId: ids.campaign,
    executionId: ids.execution,
    kind: 'screenshot',
    mediaType: 'image/png',
    byteLength: body.byteLength,
    sha256: digest(body),
    capturedAt: new Date('2026-07-29T11:00:00.000Z'),
    sensitivity: 'standard',
    redactionState: 'not_required',
    redactionVersion: null,
    retentionClass: 'passing_run_rich',
    retentionExpiresAt: new Date('2026-08-12T12:00:00.000Z'),
    parentArtifactId: null,
    body,
    ...overrides,
  };
}

function digest(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}
