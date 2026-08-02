import { createHash } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { RequestContextService } from '../src/core/request-context/request-context.service';
import {
  IdempotencyService,
  IdempotencyTransaction,
} from '../src/infrastructure/idempotency';
import {
  InProcessOrderedEventPublisher,
  ORDERED_EVENT_PUBLISHER,
  OrderedEvent,
  OrderedEventService,
} from '../src/infrastructure/events';
import {
  OBJECT_STORAGE,
  ObjectNotFoundError,
  ObjectStoragePort,
} from '../src/infrastructure/object-storage';
import {
  AuditRequestHelper,
  AuditService,
  MVP_AUDIT_ACTIONS,
} from '../src/modules/audit';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { AuthenticatedActor } from '../src/modules/auth/types/authenticated-actor.type';
import { JwtPayload } from '../src/modules/auth/types/jwt-payload.type';
import {
  EVIDENCE_ARTIFACT_REPOSITORY,
  EvidenceArtifactRepository,
  EvidenceService,
} from '../src/modules/testing/evidence';

const ORGANIZATION_ID = 'foundation-organization-fixture';
const STREAM_ID = 'foundation-mutation-stream';
const CAPTURED_AT = new Date('2026-07-30T10:00:00.000Z');
const RETAIN_UNTIL = new Date('2026-08-29T10:00:00.000Z');

describe('Neutral foundation atomic composition (e2e)', () => {
  let app: INestApplication;
  let actor: AuthenticatedActor;
  let idempotency: IdempotencyService;
  let evidence: EvidenceService;
  let evidenceRepository: EvidenceArtifactRepository;
  let storage: ObjectStoragePort;
  let audit: AuditService;
  let auditRequest: AuditRequestHelper;
  let events: OrderedEventService;
  let requestContext: RequestContextService;
  let published: OrderedEvent[];
  let unsubscribe: () => void;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    idempotency = app.get(IdempotencyService);
    evidence = app.get(EvidenceService);
    evidenceRepository = app.get<EvidenceArtifactRepository>(
      EVIDENCE_ARTIFACT_REPOSITORY,
    );
    storage = app.get<ObjectStoragePort>(OBJECT_STORAGE);
    audit = app.get(AuditService);
    auditRequest = app.get(AuditRequestHelper);
    events = app.get(OrderedEventService);
    requestContext = app.get(RequestContextService);

    const issued = await app.get(AuthService).issueTokenPair({
      id: 'foundation-principal-fixture',
      email: 'foundation-principal@example.test',
      roles: ['tester'],
      permissions: ['testing.foundation.write'],
    });
    const payload = await app
      .get(JwtService)
      .verifyAsync<JwtPayload>(issued.accessToken);
    actor = await app.get(JwtStrategy).validate(payload);

    published = [];
    const subscription = app
      .get<InProcessOrderedEventPublisher>(ORDERED_EVENT_PUBLISHER)
      .subscribe(STREAM_ID, (event) => {
        published.push(event);
      });
    unsubscribe = () => subscription.unsubscribe();
  });

  afterAll(async () => {
    unsubscribe?.();
    await app?.close();
  });

  it('commits and replays one authenticated, audited, safe mutation', async () => {
    const evidenceId = 'foundation-evidence-ok-001';
    let executions = 0;
    const execute = (requestId: string) =>
      withRequestContext(requestId, () =>
        idempotency.execute(
          scope('foundation-idempotency-ok-001'),
          { evidenceId, confidence: '1.0000' },
          async (transaction) => {
            executions += 1;
            return mutation(transaction, evidenceId, false);
          },
        ),
      );

    const first = await execute('foundation-request-ok-001');
    const replay = await execute('foundation-request-ok-002');

    expect(replay).toEqual(first);
    expect(executions).toBe(1);
    expect(await committedCounts(evidenceId)).toEqual({
      audit: 1,
      events: 1,
      evidence: 1,
      published: 1,
    });
    expect(
      await storage.get('foundation-tenant-fixture', evidenceId),
    ).toMatchObject({
      mediaType: 'text/plain',
      byteLength: foundationBody(evidenceId).byteLength,
    });

    const page = await events.readPage({ streamId: STREAM_ID, limit: 100 });
    expect(page.events[0]?.payload).toEqual({ evidenceId });
    const serializedEvent = JSON.stringify(page.events[0]);
    expect(serializedEvent).not.toContain('foundation-principal@example.test');
    expect(serializedEvent).not.toContain('accessToken');
    expect(serializedEvent).not.toContain('objectName');
    expect(serializedEvent).not.toContain(
      foundationBody(evidenceId).toString('utf8'),
    );
  });

  it('rolls back every participant and leaves a failed key retryable', async () => {
    const evidenceId = 'foundation-evidence-rb-001';
    const before = await committedCounts(evidenceId);
    let fail = true;
    const execute = (requestId: string) =>
      withRequestContext(requestId, () =>
        idempotency.execute(
          scope('foundation-idempotency-rb-001'),
          { evidenceId, confidence: '0.7500' },
          (transaction) => mutation(transaction, evidenceId, fail),
        ),
      );

    await expect(execute('foundation-request-rb-001')).rejects.toThrow(
      'FOUNDATION_MUTATION_FAILURE',
    );
    expect(await committedCounts(evidenceId)).toEqual(before);
    await expect(
      storage.get('foundation-tenant-fixture', evidenceId),
    ).rejects.toBeInstanceOf(ObjectNotFoundError);

    fail = false;
    await expect(execute('foundation-request-rb-002')).resolves.toMatchObject({
      status: 201,
      body: { evidenceId, confidence: '0.7500' },
    });
    expect(await committedCounts(evidenceId)).toEqual({
      audit: before.audit + 1,
      events: before.events + 1,
      evidence: 1,
      published: before.published + 1,
    });
  });

  async function mutation(
    transaction: IdempotencyTransaction,
    evidenceId: string,
    fail: boolean,
  ) {
    const body = foundationBody(evidenceId);
    const artifact = await evidence.upload(
      {
        id: evidenceId,
        tenantId: 'foundation-tenant-fixture',
        projectId: 'foundation-project-fixture',
        campaignId: 'foundation-campaign-fixture',
        executionId: 'foundation-execution-fixture',
        kind: 'human_note',
        mediaType: 'text/plain',
        byteLength: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
        capturedAt: CAPTURED_AT,
        sensitivity: 'standard',
        redactionState: 'not_required',
        redactionVersion: null,
        retentionClass: 'audit',
        retentionExpiresAt: RETAIN_UNTIL,
        parentArtifactId: null,
        body,
      },
      transaction,
    );
    const auditActor = auditRequest.fromAuthenticatedActor(actor);
    await audit.appendRequired(
      {
        organizationId: ORGANIZATION_ID,
        ...auditActor,
        action: MVP_AUDIT_ACTIONS.FIXTURE_SETUP,
        targetType: 'foundation_fixture',
        targetId: artifact.id,
        metadata: { evidenceId: artifact.id },
        outcome: 'succeeded',
        occurredAt: CAPTURED_AT,
      },
      transaction,
    );
    await events.append(
      {
        id: `event-${artifact.id}`,
        streamId: STREAM_ID,
        type: 'evidence.captured',
        schemaVersion: '1.0.0',
        occurredAt: CAPTURED_AT,
        actorType: 'principal',
        correlationId: auditActor.requestId,
        payload: { ...evidence.eventReference(artifact) },
        retention: { class: 'audit', retainUntil: RETAIN_UNTIL },
      },
      transaction,
    );
    if (fail) throw new Error('FOUNDATION_MUTATION_FAILURE');
    return {
      status: 201,
      body: {
        evidenceId: artifact.id,
        capturedAt: artifact.capturedAt.toISOString(),
        confidence: artifact.id.includes('-rb-') ? '0.7500' : '1.0000',
      },
    } as const;
  }

  async function committedCounts(evidenceId: string) {
    const [auditPage, eventPage, metadata] = await Promise.all([
      audit.listForOrganization({
        organizationId: ORGANIZATION_ID,
        limit: 100,
      }),
      events.readPage({ streamId: STREAM_ID, limit: 100 }),
      evidenceRepository.find('foundation-tenant-fixture', evidenceId),
    ]);
    return {
      audit: auditPage.items.length,
      events: eventPage.events.length,
      evidence: metadata ? 1 : 0,
      published: published.length,
    };
  }

  function scope(key: string) {
    return {
      organizationId: ORGANIZATION_ID,
      principalId: actor.id,
      method: 'POST',
      canonicalPath: '/foundation/fixture-mutations',
      key,
    };
  }

  function withRequestContext<T>(requestId: string, work: () => Promise<T>) {
    return requestContext.run(
      {
        requestId,
        method: 'POST',
        route: '/foundation/fixture-mutations',
        startedAtEpochMs: CAPTURED_AT.getTime(),
        queryCount: 0,
        slowQueryCount: 0,
        queryFingerprints: new Map(),
        reportedNPlusOne: new Set(),
      },
      work,
    );
  }
});

function foundationBody(evidenceId: string): Buffer {
  return Buffer.from(`safe foundation evidence for ${evidenceId}`, 'utf8');
}
