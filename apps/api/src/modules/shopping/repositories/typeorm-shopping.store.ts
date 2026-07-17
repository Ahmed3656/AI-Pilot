import { DeepPartial, Repository } from 'typeorm';
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

export class TypeormShoppingStore implements ShoppingStore {
  constructor(
    private readonly runs: Repository<ShoppingRun>,
    private readonly attempts: Repository<MerchantAttempt>,
    private readonly offers: Repository<NormalizedOffer>,
    private readonly coupons: Repository<CouponAttempt>,
    private readonly approvals: Repository<RunApproval>,
    private readonly events: Repository<RunEvent>,
    private readonly evidence: Repository<EvidenceArtifact>,
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

  saveCouponAttempt(data: DeepPartial<CouponAttempt>): Promise<CouponAttempt> {
    return this.coupons.save(this.coupons.create(data));
  }

  saveApproval(data: DeepPartial<RunApproval>): Promise<RunApproval> {
    return this.approvals.save(this.approvals.create(data));
  }

  async appendEvent(data: DeepPartial<RunEvent>): Promise<RunEvent | null> {
    try {
      return await this.events.save(this.events.create(data));
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  saveEvidence(data: DeepPartial<EvidenceArtifact>): Promise<EvidenceArtifact> {
    return this.evidence.save(this.evidence.create(data));
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
      this.offers.find({ where: { runId }, order: { finalTotal: 'ASC' } }),
      this.coupons.find({ where: { runId }, order: { createdAt: 'ASC' } }),
      this.approvals.find({ where: { runId }, order: { createdAt: 'ASC' } }),
      this.events.find({ where: { runId }, order: { createdAt: 'ASC' } }),
      this.evidence.find({ where: { runId }, order: { createdAt: 'ASC' } }),
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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
