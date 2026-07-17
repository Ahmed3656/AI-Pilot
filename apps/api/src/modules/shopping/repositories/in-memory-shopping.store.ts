import { Injectable } from '@nestjs/common';
import { DeepPartial } from 'typeorm';
import {
  CouponAttempt,
  EvidenceArtifact,
  MerchantAttempt,
  NormalizedOffer,
  RunApproval,
  RunEvent,
  ShoppingRun,
} from '../entities';
import { ShoppingRunReportData, ShoppingStore } from './shopping-store';

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
    const attempt = this.createEntity(MerchantAttempt, data);
    this.attempts.set(attempt.id, attempt);
    return Promise.resolve(attempt);
  }

  saveOffer(data: DeepPartial<NormalizedOffer>): Promise<NormalizedOffer> {
    const offer = this.createEntity(NormalizedOffer, data);
    this.offers.set(offer.id, offer);
    return Promise.resolve(offer);
  }

  saveCouponAttempt(data: DeepPartial<CouponAttempt>): Promise<CouponAttempt> {
    const attempt = this.createEntity(CouponAttempt, data);
    this.coupons.set(attempt.id, attempt);
    return Promise.resolve(attempt);
  }

  saveApproval(data: DeepPartial<RunApproval>): Promise<RunApproval> {
    const approval = this.createEntity(RunApproval, data);
    this.approvals.set(approval.id, approval);
    return Promise.resolve(approval);
  }

  appendEvent(data: DeepPartial<RunEvent>): Promise<RunEvent | null> {
    const duplicate = [...this.events.values()].some(
      (event) => event.runId === data.runId && event.eventId === data.eventId,
    );
    if (duplicate) return Promise.resolve(null);
    const event = this.createEntity(RunEvent, data);
    this.events.set(event.id, event);
    return Promise.resolve(event);
  }

  saveEvidence(data: DeepPartial<EvidenceArtifact>): Promise<EvidenceArtifact> {
    const artifact = this.createEntity(EvidenceArtifact, data);
    this.evidence.set(artifact.id, artifact);
    return Promise.resolve(artifact);
  }

  report(runId: string): Promise<ShoppingRunReportData> {
    return Promise.resolve({
      merchantAttempts: this.forRun(this.attempts, runId),
      offers: this.forRun(this.offers, runId).sort(
        (left, right) => left.finalTotal - right.finalTotal,
      ),
      couponAttempts: this.forRun(this.coupons, runId),
      approvals: this.forRun(this.approvals, runId),
      events: this.forRun(this.events, runId),
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
    ]) {
      collection.clear();
    }
  }

  private forRun<T extends Persisted & { runId: string }>(
    source: Map<string, T>,
    runId: string,
  ): T[] {
    return [...source.values()]
      .filter((item) => item.runId === runId)
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      );
  }

  private createEntity<T extends Persisted>(
    EntityType: new () => T,
    data: DeepPartial<T>,
  ): T {
    const now = new Date();
    return Object.assign(new EntityType(), data, {
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }
}
