import type { Repository } from 'typeorm';
import { TestingEvidenceArtifact } from './evidence-artifact.entity';
import { TypeormEvidenceArtifactRepository } from './evidence-artifact.repository';
import type { EvidenceArtifactMetadata } from './evidence.types';

describe('TypeormEvidenceArtifactRepository', () => {
  it('persists the private logical object name without exposing it in metadata', async () => {
    const findOne = jest.fn(() => Promise.resolve(null));
    const create = jest.fn((value: TestingEvidenceArtifact) => value);
    const save = jest.fn((value: TestingEvidenceArtifact) =>
      Promise.resolve(value),
    );
    const repository = new TypeormEvidenceArtifactRepository({
      findOne,
      create,
      save,
    } as unknown as Repository<TestingEvidenceArtifact>);

    await repository.save(metadata());

    expect(create.mock.calls[0][0]).toMatchObject({
      objectName: '01J00000000000000000000000',
      byteLength: '14',
    });
  });
});

function metadata(): EvidenceArtifactMetadata {
  return {
    id: '01J00000000000000000000000',
    tenantId: 'tenant-a',
    projectId: 'project-1',
    campaignId: 'campaign-1',
    executionId: 'execution-1',
    kind: 'screenshot',
    mediaType: 'image/png',
    byteLength: 14,
    sha256: 'a'.repeat(64),
    capturedAt: new Date('2026-07-29T11:00:00.000Z'),
    sensitivity: 'standard',
    redactionState: 'not_required',
    redactionVersion: null,
    retentionClass: 'passing_run_rich',
    retentionExpiresAt: new Date('2026-08-12T11:00:00.000Z'),
    parentArtifactId: null,
    deletionState: 'available',
    deletedAt: null,
  };
}
