import { OfferReport, RunReport } from './types';

export interface PresentedOffer {
  offer: OfferReport;
  validity: 'valid' | 'excluded' | 'incomplete';
  isWinner: boolean;
}

export function warningListKey(
  warning: RunReport['warnings'][number],
  index: number,
): string {
  // Reports preserve every warning event, but warning records have no ID.
  // Include the occurrence so identical retry warnings remain distinct rows.
  return `${index}:${warning.code}:${warning.message}`;
}

export function presentOffers(report: RunReport): PresentedOffer[] {
  const winnerId = report.conclusion?.winnerOfferId ?? null;
  return [
    ...report.validOffers.map((offer) => ({
      offer,
      validity: 'valid' as const,
      isWinner: offer.id === winnerId,
    })),
    ...report.incompleteOffers.map((offer) => ({
      offer,
      validity: 'incomplete' as const,
      isWinner: false,
    })),
    ...report.excludedOffers.map((offer) => ({
      offer,
      validity: 'excluded' as const,
      isWinner: false,
    })),
  ];
}
