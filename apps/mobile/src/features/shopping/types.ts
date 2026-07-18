export type RequestedCategory = 'auto' | 'retail' | 'food' | 'cinema';
export type ShoppingCategory = Exclude<RequestedCategory, 'auto'>;
export type AppLocale = 'ar-EG' | 'en-EG';

export const RUN_STATUSES = [
  'clarifying',
  'discovering',
  'awaiting_domain_approval',
  'comparing',
  'awaiting_address_consent',
  'awaiting_seat_hold_approval',
  'coupon_testing',
  'ready_for_handoff',
  'user_takeover',
  'paused',
  'completed',
  'cancelled',
  'failed',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type ActiveRunStatus = Exclude<
  RunStatus,
  'paused' | 'completed' | 'cancelled' | 'failed'
>;

export interface CreateShoppingRunRequest {
  query: string;
  category: RequestedCategory;
  locale: AppLocale;
}

export interface Merchant {
  id: string;
  name: string;
  domain: string;
  category: ShoppingCategory;
  market: 'EG';
  currency: 'EGP';
}

export const ADDRESS_FIELDS = [
  'recipientName',
  'mobileNumber',
  'governorate',
  'cityOrArea',
  'street',
  'building',
  'floor',
  'apartment',
  'landmark',
  'postalCode',
] as const;

export type AddressField = (typeof ADDRESS_FIELDS)[number];

export interface EgyptAddress {
  recipientName: string;
  mobileNumber: string;
  governorate: string;
  cityOrArea: string;
  street: string;
  building: string;
  floor: string;
  apartment: string;
  landmark: string;
  postalCode?: string;
}

export type PendingAction =
  | {
      type: 'clarification';
      requestId: string;
      questions: { id: string; prompt: string; required: boolean }[];
    }
  | {
      type: 'domain_approval';
      requestId: string;
      candidates: Merchant[];
    }
  | {
      type: 'address_consent';
      requestId: string;
      merchantDomains: string[];
      fields: AddressField[];
    }
  | {
      type: 'seat_hold_approval';
      requestId: string;
      offerId: string;
      merchantDomain: string;
      holdDurationSeconds: number | null;
    }
  | {
      type: 'browser_takeover';
      requestId: string;
      merchantAttemptId: string;
      merchantName: string;
      merchantDomain: string;
      reasonCode: string;
      message: string;
    }
  | { type: 'handoff'; requestId: string };

export interface RunResource {
  id: string;
  requestedCategory: RequestedCategory;
  category: ShoppingCategory | null;
  market: 'EG';
  currency: 'EGP';
  timezone: 'Africa/Cairo';
  locale: AppLocale;
  query: string;
  status: RunStatus;
  resumeStatus: ActiveRunStatus | null;
  pendingAction: PendingAction | null;
  failure: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  browserExpiresAt: string;
  lastEventId: string | null;
}

export interface ApprovalResource {
  id: string;
  runId: string;
  requestId: string;
  type: 'domain_access' | 'address_share' | 'seat_hold';
  merchantDomains: string[];
  offerId: string | null;
  status: 'approved' | 'expired' | 'revoked';
  approvedAt: string;
  expiresAt: string | null;
}

export interface ControlLease {
  id: string;
  runId: string;
  holderUserId: string;
  status: 'active' | 'released' | 'expired' | 'recovering';
  claimedAt: string;
  renewedAt: string;
  expiresAt: string;
}

export type MerchantAttemptOutcome =
  | 'succeeded'
  | 'blocked'
  | 'timed_out'
  | 'unavailable'
  | 'safety_paused'
  | 'failed';
export type CouponStatus =
  'verified' | 'rejected' | 'not_tested' | 'technical_failure';
export type CouponRejectionReason =
  | 'invalid_code'
  | 'expired'
  | 'not_eligible'
  | 'minimum_not_met'
  | 'merchant_restriction'
  | 'product_restriction'
  | 'payment_method_required'
  | 'already_applied'
  | 'not_stackable'
  | 'technical_failure'
  | 'unknown';
export type EvidenceKind =
  | 'screenshot'
  | 'dom_snapshot'
  | 'price_text'
  | 'coupon_source'
  | 'coupon_result'
  | 'seat_hold';

export type EventType =
  | 'run.created'
  | 'run.clarification_required'
  | 'run.clarification_submitted'
  | 'run.status_changed'
  | 'domains.approval_required'
  | 'domains.approved'
  | 'address.approval_required'
  | 'address.granted'
  | 'seat_hold.approval_required'
  | 'seat_hold.approved'
  | 'merchant.attempt_started'
  | 'merchant.attempt_completed'
  | 'offer.recorded'
  | 'coupon.attempted'
  | 'evidence.captured'
  | 'run.warning'
  | 'control.claimed'
  | 'control.renewed'
  | 'control.released'
  | 'control.lease_expired'
  | 'report.updated'
  | 'run.completed'
  | 'run.cancelled'
  | 'run.failed'
  | 'stream.reset_required';

export interface EventPayloadMap {
  'run.created': {
    requestedCategory: RequestedCategory;
    category: ShoppingCategory | null;
    locale: AppLocale;
  };
  'run.clarification_required': {
    requestId: string;
    questions: { id: string; prompt: string; required: boolean }[];
  };
  'run.clarification_submitted': {
    requestId: string;
    answeredQuestionIds: string[];
    category: ShoppingCategory | null;
  };
  'run.status_changed': {
    from: RunStatus;
    to: RunStatus;
    reasonCode: string | null;
  };
  'domains.approval_required': { requestId: string; candidates: Merchant[] };
  'domains.approved': {
    approvalId: string;
    requestId: string;
    domains: string[];
  };
  'address.approval_required': {
    requestId: string;
    merchantDomains: string[];
    fields: AddressField[];
  };
  'address.granted': {
    approvalId: string;
    requestId: string;
    merchantDomains: string[];
    expiresAt: string;
  };
  'seat_hold.approval_required': {
    requestId: string;
    offerId: string;
    merchantDomain: string;
    holdDurationSeconds: number | null;
  };
  'seat_hold.approved': {
    approvalId: string;
    requestId: string;
    offerId: string;
    merchantDomain: string;
  };
  'merchant.attempt_started': {
    attemptId: string;
    merchantId: string;
    merchantDomain: string;
    category: ShoppingCategory;
  };
  'merchant.attempt_completed': {
    attemptId: string;
    outcome: MerchantAttemptOutcome;
    failureCode: string | null;
    evidenceIds: string[];
  };
  'offer.recorded': {
    offerId: string;
    validity: 'valid' | 'excluded' | 'incomplete';
    merchantAttemptId: string;
    evidenceIds: string[];
    offer?: Pick<
      OfferReport,
      | 'title'
      | 'sourceUrl'
      | 'match'
      | 'availability'
      | 'details'
      | 'price'
      | 'exclusionReason'
      | 'incompleteFields'
    > & { observedAt?: string };
  };
  'coupon.attempted': {
    couponAttemptId: string;
    offerId: string;
    status: CouponStatus;
    rejectionReason: CouponRejectionReason | null;
    evidenceIds: string[];
    coupon: Pick<
      CouponAttemptReport,
      | 'code'
      | 'sourceUrl'
      | 'beforeTotal'
      | 'afterTotal'
      | 'verifiedDiscount'
      | 'message'
    >;
  };
  'evidence.captured': {
    evidenceId: string;
    kind: EvidenceKind;
    merchantAttemptId: string | null;
    redacted: true;
  };
  'run.warning': {
    code: string;
    message: string;
    merchantAttemptId: string | null;
    evidenceIds: string[];
    requiresUserInput?: boolean;
  };
  'control.claimed': {
    leaseId: string;
    holderUserId: string;
    expiresAt: string;
    merchantAttemptId: string;
  };
  'control.renewed': { leaseId: string; expiresAt: string };
  'control.released': {
    leaseId: string;
    releasedAt: string;
    recovery: 'resumed';
  };
  'control.lease_expired': {
    leaseId: string;
    expiredAt: string;
    recovery: 'pending' | 'resumed';
  };
  'report.updated': {
    validOfferCount: number;
    excludedOfferCount: number;
    incompleteOfferCount: number;
  };
  'run.completed': { completedAt: string; reportId: string };
  'run.cancelled': { cancelledAt: string; reasonCode: string | null };
  'run.failed': {
    failedAt: string;
    failureCode: string;
    retryable: boolean;
  };
  'stream.reset_required': {
    reason: 'cursor_expired';
    oldestAvailableEventId: string;
    snapshotUrl: string;
  };
}

export type EventEnvelope<T extends EventType = EventType> = T extends EventType
  ? {
      id: string;
      runId: string;
      type: T;
      status: RunStatus;
      timestamp: string;
      payload: EventPayloadMap[T];
    }
  : never;

export interface EventHistoryResponse {
  events: EventEnvelope[];
  nextAfter: string | null;
  hasMore: boolean;
}

export interface ShoppingRunSnapshot extends RunResource {
  events: EventEnvelope[];
}

export interface PriceBreakdown {
  itemSubtotal: string;
  deliveryFee: string | null;
  serviceFee: string | null;
  bookingFee: string | null;
  tax: string | null;
  mandatoryFees: {
    label: string;
    amount: string;
    evidenceIds: string[];
  }[];
  verifiedDiscount: string;
  optionalTip: '0.00' | null;
  finalTotal: string | null;
}

export interface MerchantAttemptReport {
  id: string;
  merchantId: string;
  merchantName: string;
  merchantDomain: string;
  category: ShoppingCategory;
  outcome: MerchantAttemptOutcome;
  startedAt: string;
  finishedAt: string | null;
  failureCode: string | null;
  message: string | null;
  evidenceIds: string[];
}

export interface RetailOfferDetails {
  kind: 'retail';
  brand: string;
  model: string;
  variant: string | null;
  storage: string | null;
  size: string | null;
  color: string | null;
  quantity: number;
  condition: 'new';
  deliveryEstimate: string | null;
}

export interface FoodOfferDetails {
  kind: 'food';
  restaurant: string;
  meal: string;
  size: string | null;
  modifiers: string[];
  rating: number | null;
  minimumOrder: string | null;
  deliveryEstimate: string | null;
  optionalTipExcluded: true;
  sourceName?: string;
  branchArea?: string | null;
  distanceKm?: number | null;
  distanceText?: string | null;
  proximityBasis?:
    'route_distance' | 'same_area' | 'branch_area_only' | 'unknown';
  priceScope?: 'menu_price' | 'delivered_total';
}

export interface CinemaOfferDetails {
  kind: 'cinema';
  movie: string;
  venue: string;
  date: string;
  showtime: string;
  language: string;
  screenFormat: string;
  seatCount: number;
  adjacentSeats: boolean;
  seatType: string;
  holdExpiresAt: string | null;
}

export type OfferDetails =
  RetailOfferDetails | FoodOfferDetails | CinemaOfferDetails;

export interface OfferReport {
  id: string;
  merchantAttemptId: string;
  category: ShoppingCategory;
  merchantName: string;
  merchantDomain: string;
  title: string;
  sourceUrl: string;
  match: { exact: boolean; confidence: number; explanation: string };
  availability: 'available' | 'unavailable' | 'unknown';
  details: OfferDetails;
  price: PriceBreakdown;
  observedAt: string;
  evidenceIds: string[];
  exclusionReason: string | null;
  incompleteFields: string[];
}

export interface CouponAttemptReport {
  id: string;
  offerId: string;
  merchantDomain: string;
  code: string;
  sourceUrl: string;
  status: CouponStatus;
  beforeTotal: string;
  afterTotal: string | null;
  verifiedDiscount: string;
  rejectionReason: CouponRejectionReason | null;
  message: string | null;
  attemptedAt: string;
  evidenceIds: string[];
}

export interface EvidenceReference {
  id: string;
  kind: EvidenceKind;
  uri: string;
  sha256: string;
  capturedAt: string;
  merchantAttemptId: string | null;
  redacted: true;
}

export interface RunReport {
  id: string;
  runId: string;
  status: 'in_progress' | 'final';
  category: ShoppingCategory | null;
  market: 'EG';
  currency: 'EGP';
  timezone: 'Africa/Cairo';
  generatedAt: string;
  merchantAttempts: MerchantAttemptReport[];
  validOffers: OfferReport[];
  excludedOffers: OfferReport[];
  incompleteOffers: OfferReport[];
  couponAttempts: CouponAttemptReport[];
  evidence: EvidenceReference[];
  warnings: { code: string; message: string; evidenceIds: string[] }[];
  partialFailures: {
    merchantAttemptId: string;
    code: string;
    message: string;
    retryable: boolean;
  }[];
  conclusion: null | {
    outcome: 'winner' | 'comparison_incomplete' | 'no_valid_offers';
    winnerOfferId: string | null;
    validOfferCount: number;
    statement: string;
  };
}

export interface ViewerTokenResponse {
  token: string;
  tokenType: 'Bearer';
  mode: 'view' | 'control';
  viewerUrl: string;
  expiresAt: string;
}
