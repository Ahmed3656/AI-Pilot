import { DeepPartial, MoreThan, Repository } from 'typeorm';
import { ContractException } from '../../../core/filters/contract-exception';
import {
  ControlLease,
  CouponAttempt,
  EvidenceArtifact,
  IdempotencyRecord,
  MerchantAttempt,
  NormalizedOffer,
  RunApproval,
  RunEvent,
  ShoppingRun,
} from '../entities';
import { ControlLeaseStatus } from '../shopping.types';
import {
  AppendEventResult,
  ShoppingRunReportData,
  ShoppingStore,
} from './shopping-store';

export class TypeormShoppingStore implements ShoppingStore {
  constructor(
    private readonly runs: Repository<ShoppingRun>,
    private readonly attempts: Repository<MerchantAttempt>,
    private readonly offers: Repository<NormalizedOffer>,
    private readonly coupons: Repository<CouponAttempt>,
    private readonly approvals: Repository<RunApproval>,
    private readonly events: Repository<RunEvent>,
    private readonly evidence: Repository<EvidenceArtifact>,
    private readonly leases: Repository<ControlLease>,
    private readonly idempotency: Repository<IdempotencyRecord>,
  ) {}

  createRun(data: DeepPartial<ShoppingRun>): Promise<ShoppingRun> {
    return this.runs.save(this.runs.create(data));
  }
  saveRun(run: ShoppingRun): Promise<ShoppingRun> {
    return this.runs.save(run);
  }
  findRun(id: string): Promise<ShoppingRun | null> {
    return this.runs.findOneBy({ id });
  }
  saveMerchantAttempt(
    data: DeepPartial<MerchantAttempt>,
  ): Promise<MerchantAttempt> {
    return this.attempts.save(this.attempts.create(data));
  }
  saveOffer(data: DeepPartial<NormalizedOffer>): Promise<NormalizedOffer> {
    return this.offers.save(this.offers.create(data));
  }
  findOffer(id: string): Promise<NormalizedOffer | null> {
    return this.offers.findOneBy({ id });
  }
  saveCouponAttempt(data: DeepPartial<CouponAttempt>): Promise<CouponAttempt> {
    return this.coupons.save(this.coupons.create(data));
  }
  saveApproval(data: DeepPartial<RunApproval>): Promise<RunApproval> {
    return this.approvals.save(this.approvals.create(data));
  }

  async saveRunAndApproval(
    run: ShoppingRun,
    approval: RunApproval,
  ): Promise<void> {
    await this.runs.manager.transaction(async (manager) => {
      await manager.getRepository(RunApproval).save(approval);
      await manager.getRepository(ShoppingRun).save(run);
    });
  }

  async appendEvent(data: DeepPartial<RunEvent>): Promise<AppendEventResult> {
    const eventId = String(data.eventId);
    const existing = await this.events.findOneBy({ eventId });
    if (existing) return duplicateEvent(existing, data);
    try {
      return {
        event: await this.events.save(this.events.create(data)),
        duplicate: false,
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.events.findOneByOrFail({ eventId });
      return duplicateEvent(raced, data);
    }
  }

  async eventsAfter(
    runId: string,
    after: string | undefined,
    limit: number,
  ): Promise<{ events: RunEvent[]; hasMore: boolean }> {
    let sequence = '0';
    if (after) {
      const cursor = await this.events.findOneBy({ runId, eventId: after });
      if (!cursor)
        throw new ContractException(
          'EVENT_ID_CONFLICT',
          409,
          'Event cursor is not in retained history',
        );
      sequence = cursor.sequence;
    }
    const events = await this.events
      .createQueryBuilder('event')
      .where('event.run_id = :runId', { runId })
      .andWhere('event.sequence > :sequence', { sequence })
      .orderBy('event.sequence', 'ASC')
      .take(limit + 1)
      .getMany();
    return { events: events.slice(0, limit), hasMore: events.length > limit };
  }

  saveEvidence(data: DeepPartial<EvidenceArtifact>): Promise<EvidenceArtifact> {
    return this.evidence.save(this.evidence.create(data));
  }
  saveLease(data: DeepPartial<ControlLease>): Promise<ControlLease> {
    return this.leases.save(this.leases.create(data));
  }
  async saveRunAndLease(run: ShoppingRun, lease: ControlLease): Promise<void> {
    await this.runs.manager.transaction(async (manager) => {
      await manager.getRepository(ControlLease).save(lease);
      await manager.getRepository(ShoppingRun).save(run);
    });
  }
  findLease(id: string): Promise<ControlLease | null> {
    return this.leases.findOneBy({ id });
  }
  findActiveLease(runId: string): Promise<ControlLease | null> {
    return this.leases.findOneBy({ runId, status: ControlLeaseStatus.Active });
  }

  findIdempotency(
    scope: Pick<IdempotencyRecord, 'principalId' | 'method' | 'path' | 'key'>,
  ): Promise<IdempotencyRecord | null> {
    return this.idempotency.findOneBy({
      ...scope,
      expiresAt: MoreThan(new Date()),
    });
  }

  saveIdempotency(
    data: DeepPartial<IdempotencyRecord>,
  ): Promise<IdempotencyRecord> {
    return this.idempotency.save(this.idempotency.create(data));
  }

  async report(runId: string): Promise<ShoppingRunReportData> {
    const [
      merchantAttempts,
      offers,
      couponAttempts,
      approvals,
      events,
      evidence,
    ] = await Promise.all([
      this.attempts.find({ where: { runId }, order: { createdAt: 'ASC' } }),
      this.offers.find({ where: { runId }, order: { createdAt: 'ASC' } }),
      this.coupons.find({ where: { runId }, order: { attemptedAt: 'ASC' } }),
      this.approvals.find({ where: { runId }, order: { createdAt: 'ASC' } }),
      this.events.find({ where: { runId }, order: { sequence: 'ASC' } }),
      this.evidence.find({ where: { runId }, order: { capturedAt: 'ASC' } }),
    ]);
    return {
      merchantAttempts,
      offers,
      couponAttempts,
      approvals,
      events,
      evidence,
    };
  }
}

function duplicateEvent(
  existing: RunEvent,
  data: DeepPartial<RunEvent>,
): AppendEventResult {
  const same =
    existing.runId === data.runId &&
    existing.type === data.type &&
    existing.status === data.status &&
    existing.timestamp.toISOString() ===
      new Date(data.timestamp as Date).toISOString() &&
    JSON.stringify(existing.payload) === JSON.stringify(data.payload);
  if (!same)
    throw new ContractException(
      'EVENT_ID_CONFLICT',
      409,
      'Event ID was reused with different content',
    );
  return { event: existing, duplicate: true };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
