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

export const SHOPPING_STORE = Symbol('SHOPPING_STORE');

export interface ShoppingRunReportData {
  merchantAttempts: MerchantAttempt[];
  offers: NormalizedOffer[];
  couponAttempts: CouponAttempt[];
  approvals: RunApproval[];
  events: RunEvent[];
  evidence: EvidenceArtifact[];
}

export interface ShoppingStore {
  createRun(data: DeepPartial<ShoppingRun>): Promise<ShoppingRun>;
  saveRun(run: ShoppingRun): Promise<ShoppingRun>;
  findRun(id: string): Promise<ShoppingRun | null>;
  saveMerchantAttempt(
    data: DeepPartial<MerchantAttempt>,
  ): Promise<MerchantAttempt>;
  saveOffer(data: DeepPartial<NormalizedOffer>): Promise<NormalizedOffer>;
  saveCouponAttempt(data: DeepPartial<CouponAttempt>): Promise<CouponAttempt>;
  saveApproval(data: DeepPartial<RunApproval>): Promise<RunApproval>;
  appendEvent(data: DeepPartial<RunEvent>): Promise<RunEvent | null>;
  saveEvidence(data: DeepPartial<EvidenceArtifact>): Promise<EvidenceArtifact>;
  report(runId: string): Promise<ShoppingRunReportData>;
}
