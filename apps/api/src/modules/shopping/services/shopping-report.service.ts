import { Inject, Injectable } from '@nestjs/common';
import { NormalizedOffer, ShoppingRun } from '../entities';
import { SHOPPING_STORE, ShoppingStore } from '../repositories';
import {
  ApprovalStatus,
  ApprovalType,
  ShoppingRunState,
} from '../shopping.types';

const MONEY = /^(?:0|[1-9]\d*)\.\d{2}$/;
const FINAL_REPORT_STATES = new Set([
  ShoppingRunState.ReadyForHandoff,
  ShoppingRunState.UserTakeover,
  ShoppingRunState.Completed,
  ShoppingRunState.Cancelled,
  ShoppingRunState.Failed,
]);

@Injectable()
export class ShoppingReportService {
  constructor(@Inject(SHOPPING_STORE) private readonly store: ShoppingStore) {}

  async build(run: ShoppingRun) {
    const data = await this.store.report(run.id);
    const evidenceById = new Map(data.evidence.map((item) => [item.id, item]));
    const approved = new Set(
      data.approvals
        .filter(
          (item) =>
            item.type === ApprovalType.DomainAccess &&
            item.status === ApprovalStatus.Approved &&
            (!item.expiresAt || item.expiresAt > new Date()),
        )
        .flatMap((item) => item.merchantDomains),
    );
    const buckets = {
      valid: [] as ReturnType<typeof offerView>[],
      excluded: [] as ReturnType<typeof offerView>[],
      incomplete: [] as ReturnType<typeof offerView>[],
    };

    for (const offer of data.offers) {
      const classification = classifyOffer(
        offer,
        approved,
        evidenceById,
        data.couponAttempts,
      );
      buckets[classification].push(offerView(offer, classification));
    }
    buckets.valid.sort(compareOffers);

    const couponAttempts = data.couponAttempts.map((item) => ({
      id: item.id,
      offerId: item.offerId,
      merchantDomain: item.merchantDomain,
      code: item.code,
      sourceUrl: item.sourceUrl,
      status: item.status,
      beforeTotal: item.beforeTotal,
      afterTotal: item.afterTotal,
      verifiedDiscount:
        item.status === 'verified' ? item.verifiedDiscount : '0.00',
      rejectionReason: item.rejectionReason,
      message: item.message,
      attemptedAt: item.attemptedAt.toISOString(),
      evidenceIds: item.evidenceIds,
    }));
    const validCount = buckets.valid.length;
    const conclusion =
      validCount >= 2
        ? {
            outcome: 'winner' as const,
            winnerOfferId: buckets.valid[0].id,
            validOfferCount: validCount,
            statement:
              'Lowest verified total among the options successfully checked.',
          }
        : validCount === 1
          ? {
              outcome: 'comparison_incomplete' as const,
              winnerOfferId: null,
              validOfferCount: 1,
              statement:
                'Comparison incomplete; fewer than two complete valid offers were verified.',
            }
          : {
              outcome: 'no_valid_offers' as const,
              winnerOfferId: null,
              validOfferCount: 0,
              statement: 'No complete valid offer was verified.',
            };

    return {
      id: `report-${run.id}`,
      runId: run.id,
      status: FINAL_REPORT_STATES.has(run.status)
        ? ('final' as const)
        : ('in_progress' as const),
      category: run.category,
      market: 'EG' as const,
      currency: 'EGP' as const,
      timezone: 'Africa/Cairo' as const,
      generatedAt: new Date().toISOString(),
      merchantAttempts: data.merchantAttempts.map((item) => ({
        id: item.id,
        merchantId: item.merchantId,
        merchantName: item.merchantName,
        merchantDomain: item.merchantDomain,
        category: item.category,
        outcome: item.outcome,
        startedAt: item.startedAt.toISOString(),
        finishedAt: item.finishedAt?.toISOString() ?? null,
        failureCode: item.failureCode,
        message: item.message,
        evidenceIds: item.evidenceIds,
      })),
      validOffers: buckets.valid,
      excludedOffers: buckets.excluded,
      incompleteOffers: buckets.incomplete,
      couponAttempts,
      evidence: data.evidence.map((item) => ({
        id: item.id,
        kind: item.kind,
        uri: item.uri,
        sha256: item.sha256,
        capturedAt: item.capturedAt.toISOString(),
        merchantAttemptId: item.merchantAttemptId,
        redacted: true as const,
      })),
      warnings: data.events
        .filter((item) => item.type === 'run.warning')
        .map((item) => ({
          code: String(item.payload.code),
          message: String(item.payload.message),
          evidenceIds: stringArray(item.payload.evidenceIds),
        })),
      partialFailures: data.merchantAttempts
        .filter((item) => item.outcome !== 'succeeded')
        .map((item) => ({
          merchantAttemptId: item.id,
          code: item.failureCode ?? item.outcome.toUpperCase(),
          message: item.message ?? 'Merchant attempt did not complete',
          retryable: ['timed_out', 'unavailable', 'failed'].includes(
            item.outcome,
          ),
        })),
      conclusion,
    };
  }
}

function classifyOffer(
  offer: NormalizedOffer,
  approved: Set<string>,
  evidence: Map<string, { kind?: string }>,
  coupons: Array<{
    offerId: string;
    status: string;
    beforeTotal: string;
    afterTotal: string | null;
    verifiedDiscount: string;
    evidenceIds: string[];
  }>,
): 'valid' | 'excluded' | 'incomplete' {
  if (offer.validity === 'incomplete') return 'incomplete';
  if (
    !offer.match.exact ||
    offer.availability !== 'available' ||
    !approved.has(offer.merchantDomain) ||
    !isApprovedUrl(offer.sourceUrl, offer.merchantDomain) ||
    offer.details.kind !== offer.category
  )
    return 'excluded';
  if (
    !offer.evidenceIds.length ||
    offer.evidenceIds.some((id) => !evidence.has(id)) ||
    !validPrice(offer, evidence, coupons)
  )
    return 'incomplete';
  return offer.validity === 'excluded' ? 'excluded' : 'valid';
}

function validPrice(
  offer: NormalizedOffer,
  evidence: Map<string, { kind?: string }>,
  coupons: Array<{
    offerId: string;
    status: string;
    beforeTotal: string;
    afterTotal: string | null;
    verifiedDiscount: string;
    evidenceIds: string[];
  }>,
): boolean {
  const price = offer.price;
  if (
    !MONEY.test(price.itemSubtotal) ||
    !MONEY.test(price.verifiedDiscount) ||
    price.finalTotal === null ||
    !MONEY.test(price.finalTotal)
  )
    return false;
  const components = [
    price.deliveryFee,
    price.serviceFee,
    price.bookingFee,
    price.tax,
  ];
  if (components.some((value) => value === null || !MONEY.test(value)))
    return false;
  if (
    !Array.isArray(price.mandatoryFees) ||
    price.mandatoryFees.some(
      (fee) =>
        !MONEY.test(fee.amount) ||
        !fee.evidenceIds.length ||
        fee.evidenceIds.some((id) => !evidence.has(id)),
    )
  )
    return false;
  try {
    const total =
      cents(price.itemSubtotal) +
      components.reduce((sum, value) => sum + cents(value!), 0n) +
      price.mandatoryFees.reduce((sum, fee) => sum + cents(fee.amount), 0n) -
      cents(price.verifiedDiscount);
    if (total < 0n || total !== cents(price.finalTotal)) return false;
    if (price.verifiedDiscount === '0.00') return true;
    return coupons.some((coupon) => {
      if (
        coupon.offerId !== offer.id ||
        coupon.status !== 'verified' ||
        coupon.afterTotal === null ||
        coupon.verifiedDiscount !== price.verifiedDiscount
      )
        return false;
      const kinds = new Set(
        coupon.evidenceIds.map((id) => evidence.get(id)?.kind),
      );
      return (
        cents(coupon.beforeTotal) - cents(coupon.afterTotal) ===
          cents(coupon.verifiedDiscount) &&
        kinds.has('coupon_source') &&
        kinds.has('coupon_result')
      );
    });
  } catch {
    return false;
  }
}

function cents(value: string): bigint {
  return BigInt(value.replace('.', ''));
}

function isApprovedUrl(source: string, domain: string): boolean {
  try {
    const url = new URL(source);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      (url.hostname === domain || url.hostname.endsWith(`.${domain}`))
    );
  } catch {
    return false;
  }
}

function offerView(
  offer: NormalizedOffer,
  classification: 'valid' | 'excluded' | 'incomplete',
) {
  return {
    id: offer.id,
    merchantAttemptId: offer.merchantAttemptId,
    category: offer.category,
    merchantName: offer.merchantName,
    merchantDomain: offer.merchantDomain,
    title: offer.title,
    sourceUrl: offer.sourceUrl,
    match: offer.match,
    availability: offer.availability,
    details: offer.details,
    price: offer.price,
    observedAt: offer.observedAt.toISOString(),
    evidenceIds: offer.evidenceIds,
    exclusionReason:
      classification === 'excluded'
        ? (offer.exclusionReason ??
          'Offer is outside the valid comparison scope')
        : null,
    incompleteFields:
      classification === 'incomplete'
        ? [...new Set([...offer.incompleteFields, 'priceOrEvidence'])]
        : offer.incompleteFields,
  };
}

function compareOffers(
  left: ReturnType<typeof offerView>,
  right: ReturnType<typeof offerView>,
): number {
  const money = Number(
    cents(left.price.finalTotal!) - cents(right.price.finalTotal!),
  );
  if (money !== 0) return money;
  if (left.match.confidence !== right.match.confidence)
    return right.match.confidence - left.match.confidence;
  return left.id.localeCompare(right.id);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : [];
}
