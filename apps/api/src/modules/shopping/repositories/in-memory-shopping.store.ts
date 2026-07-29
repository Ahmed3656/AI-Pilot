import { Injectable } from '@nestjs/common';
import { DeepPartial } from 'typeorm';
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

type Persisted = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

@Injectable()
export class InMemoryShoppingStore implements ShoppingStore {
  private readonly runs = new Map<string, ShoppingRun>();
  private readonly attempts = new Map<string, MerchantAttempt>();
  private readonly offers = new Map<string, NormalizedOffer>();
  private readonly coupons = new Map<string, CouponAttempt>();
  private readonly approvals = new Map<string, RunApproval>();
  private readonly events = new Map<string, RunEvent>();
  private readonly evidence = new Map<string, EvidenceArtifact>();
  private readonly leases = new Map<string, ControlLease>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private eventSequence = 0;

  createRun(data: DeepPartial<ShoppingRun>): Promise<ShoppingRun> {
    const run = this.createEntity(ShoppingRun, data);
    this.runs.set(run.id, run);
    return Promise.resolve(run);
  }

  saveRun(run: ShoppingRun): Promise<ShoppingRun> {
    run.updatedAt = new Date();
    this.runs.set(run.id, run);
    return Promise.resolve(run);
  }

  findRun(id: string): Promise<ShoppingRun | null> {
    return Promise.resolve(this.runs.get(id) ?? null);
  }

  saveMerchantAttempt(
    data: DeepPartial<MerchantAttempt>,
  ): Promise<MerchantAttempt> {
    return this.saveEntity(this.attempts, MerchantAttempt, data);
  }

  saveOffer(data: DeepPartial<NormalizedOffer>): Promise<NormalizedOffer> {
    return this.saveEntity(this.offers, NormalizedOffer, data);
  }

  findOffer(id: string): Promise<NormalizedOffer | null> {
    return Promise.resolve(this.offers.get(id) ?? null);
  }

  saveCouponAttempt(data: DeepPartial<CouponAttempt>): Promise<CouponAttempt> {
    return this.saveEntity(this.coupons, CouponAttempt, data);
  }

  saveApproval(data: DeepPartial<RunApproval>): Promise<RunApproval> {
    return this.saveEntity(this.approvals, RunApproval, data);
  }

  async saveRunAndApproval(
    run: ShoppingRun,
    approval: RunApproval,
  ): Promise<void> {
    await this.saveApproval(approval);
    await this.saveRun(run);
  }

  appendEvent(data: DeepPartial<RunEvent>): Promise<AppendEventResult> {
    const eventId = String(data.eventId);
    const existing = [...this.events.values()].find(
      (event) => event.eventId === eventId,
    );
    if (existing) {
      if (!sameEvent(existing, data)) {
        throw new ContractException(
          'EVENT_ID_CONFLICT',
          409,
          'Event ID was reused with different content',
        );
      }
      return Promise.resolve({ event: existing, duplicate: true });
    }
    const event = this.createEntity(RunEvent, data);
    event.sequence = String(++this.eventSequence);
    this.events.set(event.id, event);
    return Promise.resolve({ event, duplicate: false });
  }

  eventsAfter(
    runId: string,
    after: string | undefined,
    limit: number,
  ): Promise<{ events: RunEvent[]; hasMore: boolean }> {
    const all = this.forRun(this.events, runId).sort(
      (a, b) => Number(a.sequence) - Number(b.sequence),
    );
    let offset = 0;
    if (after) {
      const index = all.findIndex((event) => event.eventId === after);
      if (index < 0)
        throw new ContractException(
          'EVENT_ID_CONFLICT',
          409,
          'Event cursor is not in retained history',
        );
      offset = index + 1;
    }
    return Promise.resolve({
      events: all.slice(offset, offset + limit),
      hasMore: all.length > offset + limit,
    });
  }

  saveEvidence(data: DeepPartial<EvidenceArtifact>): Promise<EvidenceArtifact> {
    return this.saveEntity(this.evidence, EvidenceArtifact, data);
  }

  findEvidence(id: string): Promise<EvidenceArtifact | null> {
    return Promise.resolve(this.evidence.get(id) ?? null);
  }

  saveLease(data: DeepPartial<ControlLease>): Promise<ControlLease> {
    return this.saveEntity(this.leases, ControlLease, data);
  }

  async saveRunAndLease(run: ShoppingRun, lease: ControlLease): Promise<void> {
    await this.saveLease(lease);
    await this.saveRun(run);
  }

  findLease(id: string): Promise<ControlLease | null> {
    return Promise.resolve(this.leases.get(id) ?? null);
  }

  findActiveLease(runId: string): Promise<ControlLease | null> {
    return Promise.resolve(
      [...this.leases.values()].find(
        (lease) =>
          lease.runId === runId && lease.status === ControlLeaseStatus.Active,
      ) ?? null,
    );
  }

  findIdempotency(
    scope: Pick<IdempotencyRecord, 'principalId' | 'method' | 'path' | 'key'>,
  ): Promise<IdempotencyRecord | null> {
    const record = this.idempotency.get(scopeKey(scope));
    return Promise.resolve(
      record && record.expiresAt > new Date() ? record : null,
    );
  }

  saveIdempotency(
    data: DeepPartial<IdempotencyRecord>,
  ): Promise<IdempotencyRecord> {
    const record = this.createEntity(IdempotencyRecord, data);
    this.idempotency.set(scopeKey(record), record);
    return Promise.resolve(record);
  }

  report(runId: string): Promise<ShoppingRunReportData> {
    return Promise.resolve({
      merchantAttempts: this.forRun(this.attempts, runId),
      offers: this.forRun(this.offers, runId),
      couponAttempts: this.forRun(this.coupons, runId),
      approvals: this.forRun(this.approvals, runId),
      events: this.forRun(this.events, runId).sort(
        (a, b) => Number(a.sequence) - Number(b.sequence),
      ),
      evidence: this.forRun(this.evidence, runId),
    });
  }

  clear(): void {
    for (const collection of [
      this.runs,
      this.attempts,
      this.offers,
      this.coupons,
      this.approvals,
      this.events,
      this.evidence,
      this.leases,
      this.idempotency,
    ])
      collection.clear();
  }

  private saveEntity<T extends Persisted>(
    source: Map<string, T>,
    EntityType: new () => T,
    data: DeepPartial<T>,
  ): Promise<T> {
    const entity = this.createEntity(EntityType, data);
    source.set(entity.id, entity);
    return Promise.resolve(entity);
  }

  private forRun<T extends Persisted & { runId: string }>(
    source: Map<string, T>,
    runId: string,
  ): T[] {
    return [...source.values()]
      .filter((item) => item.runId === runId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  private createEntity<T extends Persisted>(
    EntityType: new () => T,
    data: DeepPartial<T>,
  ): T {
    const existing = typeof data.id === 'string' ? data.id : undefined;
    const now = new Date();
    return Object.assign(new EntityType(), data, {
      ...(existing ? { id: existing } : {}),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }
}

function sameEvent(existing: RunEvent, data: DeepPartial<RunEvent>): boolean {
  return (
    existing.runId === data.runId &&
    existing.type === data.type &&
    existing.status === data.status &&
    existing.timestamp.toISOString() ===
      new Date(data.timestamp as Date).toISOString() &&
    JSON.stringify(existing.payload) === JSON.stringify(data.payload)
  );
}

function scopeKey(
  scope: Pick<IdempotencyRecord, 'principalId' | 'method' | 'path' | 'key'>,
): string {
  return `${scope.principalId}\u0000${scope.method}\u0000${scope.path}\u0000${scope.key}`;
}
