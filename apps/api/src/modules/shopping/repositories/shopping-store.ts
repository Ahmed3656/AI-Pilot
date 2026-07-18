import { DeepPartial } from 'typeorm';
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

export const SHOPPING_STORE = Symbol('SHOPPING_STORE');

export interface ShoppingRunReportData {
  merchantAttempts: MerchantAttempt[];
  offers: NormalizedOffer[];
  couponAttempts: CouponAttempt[];
  approvals: RunApproval[];
  events: RunEvent[];
  evidence: EvidenceArtifact[];
}

export interface AppendEventResult {
  event: RunEvent;
  duplicate: boolean;
}

export interface ShoppingStore {
  createRun(data: DeepPartial<ShoppingRun>): Promise<ShoppingRun>;
  saveRun(run: ShoppingRun): Promise<ShoppingRun>;
  findRun(id: string): Promise<ShoppingRun | null>;
  saveMerchantAttempt(
    data: DeepPartial<MerchantAttempt>,
  ): Promise<MerchantAttempt>;
  saveOffer(data: DeepPartial<NormalizedOffer>): Promise<NormalizedOffer>;
  findOffer(id: string): Promise<NormalizedOffer | null>;
  saveCouponAttempt(data: DeepPartial<CouponAttempt>): Promise<CouponAttempt>;
  saveApproval(data: DeepPartial<RunApproval>): Promise<RunApproval>;
  saveRunAndApproval(run: ShoppingRun, approval: RunApproval): Promise<void>;
  appendEvent(data: DeepPartial<RunEvent>): Promise<AppendEventResult>;
  eventsAfter(
    runId: string,
    after: string | undefined,
    limit: number,
  ): Promise<{ events: RunEvent[]; hasMore: boolean }>;
  saveEvidence(data: DeepPartial<EvidenceArtifact>): Promise<EvidenceArtifact>;
  findEvidence(id: string): Promise<EvidenceArtifact | null>;
  saveLease(data: DeepPartial<ControlLease>): Promise<ControlLease>;
  saveRunAndLease(run: ShoppingRun, lease: ControlLease): Promise<void>;
  findLease(id: string): Promise<ControlLease | null>;
  findActiveLease(runId: string): Promise<ControlLease | null>;
  findIdempotency(
    scope: Pick<IdempotencyRecord, 'principalId' | 'method' | 'path' | 'key'>,
  ): Promise<IdempotencyRecord | null>;
  saveIdempotency(
    data: DeepPartial<IdempotencyRecord>,
  ): Promise<IdempotencyRecord>;
  report(runId: string): Promise<ShoppingRunReportData>;
}
