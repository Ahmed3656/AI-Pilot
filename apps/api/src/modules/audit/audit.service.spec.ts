import { RequestContextService } from '../../core/request-context/request-context.service';
import { PersistenceTransactionLifecycle } from '../../database/persistence-transaction';
import type { EntityManager, Repository } from 'typeorm';
import { MVP_AUDIT_ACTIONS } from './audit-actions';
import { AuditMetadataError } from './audit-metadata';
import { AuditRequestHelper } from './audit-request.helper';
import { AppendAuditRecordInput, AuditService } from './audit.service';
import {
  InMemoryAuditRepository,
  TypeormAuditRepository,
} from './repositories/audit.repository';
import { AuditRecord } from './entities/audit-record.entity';

const occurredAt = new Date('2026-07-29T09:00:00.000Z');

function auditInput(
  overrides: Partial<AppendAuditRecordInput> = {},
): AppendAuditRecordInput {
  return {
    organizationId: 'org_alpha',
    actorType: 'principal',
    actorId: 'principal_01',
    action: MVP_AUDIT_ACTIONS.TARGET_VERIFICATION_DECIDED,
    targetType: 'testing_target',
    targetId: 'target_01',
    requestId: 'request_01',
    outcome: 'succeeded',
    occurredAt,
    ...overrides,
  };
}

describe('AuditService', () => {
  let repository: InMemoryAuditRepository;
  let service: AuditService;

  beforeEach(() => {
    repository = new InMemoryAuditRepository();
    service = new AuditService(repository);
  });

  it('offers no application-level update or delete path', () => {
    expect(repository).not.toHaveProperty('update');
    expect(repository).not.toHaveProperty('delete');
    expect(repository).not.toHaveProperty('remove');
  });

  it('rejects metadata that could retain credentials or raw target responses', async () => {
    await expect(
      service.append(
        auditInput({ metadata: { authorization: 'Bearer private' } }),
      ),
    ).rejects.toBeInstanceOf(AuditMetadataError);
    await expect(
      service.append(
        auditInput({ metadata: { targetResponse: 'raw upstream' } }),
      ),
    ).rejects.toBeInstanceOf(AuditMetadataError);
    await expect(
      service.append(auditInput({ metadata: { modelPrompt: 'do this' } })),
    ).rejects.toBeInstanceOf(AuditMetadataError);
  });

  it('stores only safe metadata and preserves UTC occurrence time', async () => {
    const record = await service.append(
      auditInput({
        metadata: { verification: 'attested', policyApplied: true },
      }),
    );

    expect(record.metadata).toEqual({
      verification: 'attested',
      policyApplied: true,
    });
    expect(record.occurredAt.toISOString()).toBe('2026-07-29T09:00:00.000Z');
  });

  it('keeps tenant reads isolated and rejects a cursor from another tenant', async () => {
    await service.append(auditInput({ targetId: 'alpha' }));
    await service.append(
      auditInput({ organizationId: 'org_beta', targetId: 'beta' }),
    );
    await service.append(auditInput({ targetId: 'alpha-2' }));

    const alpha = await service.listForOrganization({
      organizationId: 'org_alpha',
      limit: 1,
    });
    expect(alpha.items).toHaveLength(1);
    expect(alpha.items[0].organizationId).toBe('org_alpha');
    expect(alpha.nextCursor).not.toBeNull();

    await expect(
      service.listForOrganization({
        organizationId: 'org_beta',
        after: alpha.nextCursor ?? undefined,
      }),
    ).rejects.toThrow('AUDIT_CURSOR_INVALID');
  });

  it('uses a stable cursor order when records share the same time', async () => {
    const records = await Promise.all(
      ['one', 'two', 'three', 'four'].map((targetId) =>
        service.append(auditInput({ targetId })),
      ),
    );
    const expectedIds = [...records]
      .sort((left, right) => right.id.localeCompare(left.id))
      .map((record) => record.id);

    const first = await service.listForOrganization({
      organizationId: 'org_alpha',
      limit: 2,
    });
    const second = await service.listForOrganization({
      organizationId: 'org_alpha',
      after: first.nextCursor ?? undefined,
      limit: 2,
    });

    expect(
      [...first.items, ...second.items].map((record) => record.id),
    ).toEqual(expectedIds);
    expect(second.nextCursor).toBeNull();
  });

  it('rolls the audit append back when the atomic work fails', async () => {
    await expect(
      service.runAtomically(async (audit) => {
        await audit.append(auditInput());
        throw new Error('mutation failed');
      }),
    ).rejects.toThrow('mutation failed');

    await expect(
      service.listForOrganization({ organizationId: 'org_alpha' }),
    ).resolves.toMatchObject({ items: [] });
  });

  it('joins a shared in-memory transaction rollback', async () => {
    const transaction = new PersistenceTransactionLifecycle();
    await service.appendRequired(auditInput(), transaction);

    await transaction.rollback();

    await expect(
      service.listForOrganization({ organizationId: 'org_alpha' }),
    ).resolves.toMatchObject({ items: [] });
  });
});

describe('TypeormAuditRepository', () => {
  it('uses the caller-owned entity manager', async () => {
    const root = {
      create: jest.fn(),
      save: jest.fn(),
    };
    const getRepository = jest.fn();
    const transactional = {
      create: jest.fn((record: AuditRecord) => record),
      save: jest.fn((record: AuditRecord) => Promise.resolve(record)),
    };
    getRepository.mockReturnValue(transactional);
    const manager = {
      getRepository,
    } as unknown as EntityManager;
    const service = new AuditService(
      new TypeormAuditRepository(root as unknown as Repository<AuditRecord>),
    );

    await service.appendRequired(
      auditInput(),
      new PersistenceTransactionLifecycle(manager),
    );

    expect(getRepository).toHaveBeenCalledWith(AuditRecord);
    expect(transactional.save).toHaveBeenCalledTimes(1);
    expect(root.save).not.toHaveBeenCalled();
  });
});

describe('AuditRequestHelper', () => {
  it('uses the request context correlation ID for authenticated actors', () => {
    const context = new RequestContextService();
    const helper = new AuditRequestHelper(context);

    context.run(
      {
        requestId: 'correlation_01',
        method: 'POST',
        route: '/testing/targets',
        startedAtEpochMs: Date.now(),
        queryCount: 0,
        slowQueryCount: 0,
        queryFingerprints: new Map(),
        reportedNPlusOne: new Set(),
      },
      () => {
        expect(helper.fromAuthenticatedActor({ id: 'principal_01' })).toEqual({
          actorType: 'principal',
          actorId: 'principal_01',
          requestId: 'correlation_01',
        });
      },
    );
  });
});
