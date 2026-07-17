import { ShoppingCandidate, ShoppingCategory, ShoppingReport } from './types';

const requiredMerchants: Record<ShoppingCategory, string[]> = {
  retail: ['Amazon', 'Jumia', 'Noon'],
  food: ['Talabat'],
  cinema: ['VOX'],
};

function unavailableCandidate(
  category: ShoppingCategory,
  merchant: string,
): ShoppingCandidate {
  return {
    id: `unavailable-${category}-${merchant.toLowerCase()}`,
    category,
    merchant,
    title: merchant,
    breakdown: {
      subtotal: null,
      delivery: null,
      serviceFee: null,
      taxes: null,
      discount: null,
      total: null,
    },
    isComplete: false,
    incompleteReason: null,
    verifiedAt: null,
  };
}

export function withPhaseOneMerchants(
  report: ShoppingReport,
): ShoppingCandidate[] {
  const candidates = report.candidates.filter(
    (candidate) => candidate.category === report.category,
  );
  const placeholders = requiredMerchants[report.category]
    .filter(
      (merchant) =>
        !candidates.some((candidate) =>
          candidate.merchant
            .toLocaleLowerCase()
            .includes(merchant.toLowerCase()),
        ),
    )
    .map((merchant) => unavailableCandidate(report.category, merchant));
  return [...candidates, ...placeholders];
}

export function lowestVerifiedTotal(
  candidates: ShoppingCandidate[],
): number | null {
  const verified = candidates
    .filter(
      (candidate) =>
        candidate.isComplete &&
        candidate.verifiedAt !== null &&
        candidate.breakdown.total !== null,
    )
    .map((candidate) => candidate.breakdown.total as number);
  return verified.length > 0 ? Math.min(...verified) : null;
}
