import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ObservabilityModule } from '../../core/observability/observability.module';
import {
  InMemoryOrderedEventRepository,
  ORDERED_EVENT_REPOSITORY,
  OrderedEventService,
  type OrderedEventRepository,
} from '../events';
import {
  IDEMPOTENCY_REPOSITORY,
  IdempotencyService,
  InMemoryIdempotencyRepository,
  type IdempotencyRepository,
} from '../idempotency';
import {
  InMemoryObjectStorageAdapter,
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../object-storage';
import { AuditService } from '../../modules/audit/audit.service';
import {
  AUDIT_REPOSITORY,
  InMemoryAuditRepository,
  type AuditRepository,
} from '../../modules/audit/repositories/audit.repository';
import {
  EVIDENCE_ARTIFACT_REPOSITORY,
  EvidenceService,
  InMemoryEvidenceArtifactRepository,
  type EvidenceArtifactRepository,
} from '../../modules/testing/evidence';
import { NeutralFoundationModule } from './foundation.module';

const FOUNDATION_PROBE = Symbol('FOUNDATION_PROBE');

describe('NeutralFoundationModule', () => {
  it('exports one coherent database-disabled provider graph', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ObservabilityModule,
        NeutralFoundationModule.register({
          databaseEnabled: false,
          allowInMemoryObjectStorage: true,
          durablePrivateStorageRequired: false,
        }),
      ],
      providers: [
        {
          provide: FOUNDATION_PROBE,
          inject: [
            IdempotencyService,
            OrderedEventService,
            AuditService,
            EvidenceService,
            IDEMPOTENCY_REPOSITORY,
            ORDERED_EVENT_REPOSITORY,
            AUDIT_REPOSITORY,
            EVIDENCE_ARTIFACT_REPOSITORY,
            OBJECT_STORAGE,
          ],
          useFactory: (
            idempotency: IdempotencyService,
            events: OrderedEventService,
            audit: AuditService,
            evidence: EvidenceService,
            idempotencyRepository: IdempotencyRepository,
            eventRepository: OrderedEventRepository,
            auditRepository: AuditRepository,
            evidenceRepository: EvidenceArtifactRepository,
            objectStorage: ObjectStoragePort,
          ) => ({
            idempotency,
            events,
            audit,
            evidence,
            idempotencyRepository,
            eventRepository,
            auditRepository,
            evidenceRepository,
            objectStorage,
          }),
        },
      ],
    }).compile();
    const probe = moduleRef.get<{
      idempotencyRepository: IdempotencyRepository;
      eventRepository: OrderedEventRepository;
      auditRepository: AuditRepository;
      evidenceRepository: EvidenceArtifactRepository;
      objectStorage: ObjectStoragePort;
    }>(FOUNDATION_PROBE);

    expect(probe.idempotencyRepository).toBeInstanceOf(
      InMemoryIdempotencyRepository,
    );
    expect(probe.eventRepository).toBeInstanceOf(
      InMemoryOrderedEventRepository,
    );
    expect(probe.auditRepository).toBeInstanceOf(InMemoryAuditRepository);
    expect(probe.evidenceRepository).toBeInstanceOf(
      InMemoryEvidenceArtifactRepository,
    );
    expect(probe.objectStorage).toBeInstanceOf(InMemoryObjectStorageAdapter);

    await moduleRef.close();
  });
});
