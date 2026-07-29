export enum RequestedCategory {
  Auto = 'auto',
  Retail = 'retail',
  Food = 'food',
  Cinema = 'cinema',
}

export enum ShoppingCategory {
  Retail = 'retail',
  Food = 'food',
  Cinema = 'cinema',
}

export enum SupportedLocale {
  ArabicEgypt = 'ar-EG',
  EnglishEgypt = 'en-EG',
}

export enum ShoppingRunState {
  Clarifying = 'clarifying',
  Discovering = 'discovering',
  AwaitingDomainApproval = 'awaiting_domain_approval',
  Comparing = 'comparing',
  AwaitingAddressConsent = 'awaiting_address_consent',
  AwaitingSeatHoldApproval = 'awaiting_seat_hold_approval',
  CouponTesting = 'coupon_testing',
  ReadyForHandoff = 'ready_for_handoff',
  UserTakeover = 'user_takeover',
  Paused = 'paused',
  Completed = 'completed',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

export enum ApprovalType {
  DomainAccess = 'domain_access',
  AddressShare = 'address_share',
  SeatHold = 'seat_hold',
}

export enum ApprovalStatus {
  Approved = 'approved',
  Expired = 'expired',
  Revoked = 'revoked',
}

export enum ViewerMode {
  View = 'view',
  Control = 'control',
}

export enum RunControlAction {
  Pause = 'pause',
  Resume = 'resume',
  Cancel = 'cancel',
  Complete = 'complete',
}

export enum ControlLeaseStatus {
  Active = 'active',
  Released = 'released',
  Expired = 'expired',
  Recovering = 'recovering',
}

export enum AddressField {
  RecipientName = 'recipientName',
  MobileNumber = 'mobileNumber',
  Governorate = 'governorate',
  CityOrArea = 'cityOrArea',
  Street = 'street',
  Building = 'building',
  Floor = 'floor',
  Apartment = 'apartment',
  Landmark = 'landmark',
  PostalCode = 'postalCode',
}

export const ADDRESS_FIELDS = Object.values(AddressField);

export type PendingAction =
  | {
      type: 'clarification';
      requestId: string;
      questions: Array<{ id: string; prompt: string; required: boolean }>;
    }
  | {
      type: 'domain_approval';
      requestId: string;
      candidates: MerchantCatalogEntry[];
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

export interface MerchantCatalogEntry {
  id: string;
  name: string;
  domain: string;
  category: ShoppingCategory;
  market: 'EG';
  currency: 'EGP';
}

export const EGYPT_MERCHANTS: readonly MerchantCatalogEntry[] = [
  {
    id: 'amazon-eg',
    name: 'Amazon Egypt',
    domain: 'amazon.eg',
    category: ShoppingCategory.Retail,
    market: 'EG',
    currency: 'EGP',
  },
  {
    id: 'jumia-eg',
    name: 'Jumia Egypt',
    domain: 'jumia.com.eg',
    category: ShoppingCategory.Retail,
    market: 'EG',
    currency: 'EGP',
  },
  {
    id: 'noon-eg',
    name: 'Noon Egypt',
    domain: 'noon.com',
    category: ShoppingCategory.Retail,
    market: 'EG',
    currency: 'EGP',
  },
  {
    id: 'google-maps-eg',
    name: 'Google Maps',
    domain: 'google.com',
    category: ShoppingCategory.Food,
    market: 'EG',
    currency: 'EGP',
  },
  {
    id: 'menu-egypt',
    name: 'Menu Egypt',
    domain: 'menuegypt.com',
    category: ShoppingCategory.Food,
    market: 'EG',
    currency: 'EGP',
  },
  {
    id: 'elmenus-eg',
    name: 'elmenus',
    domain: 'elmenus.com',
    category: ShoppingCategory.Food,
    market: 'EG',
    currency: 'EGP',
  },
  {
    id: 'talabat-eg',
    name: 'Talabat Egypt',
    domain: 'talabat.com',
    category: ShoppingCategory.Food,
    market: 'EG',
    currency: 'EGP',
  },
  {
    id: 'vox-eg',
    name: 'VOX Egypt',
    domain: 'voxcinemas.com',
    category: ShoppingCategory.Cinema,
    market: 'EG',
    currency: 'EGP',
  },
] as const;

export const EVENT_TYPES = [
  'run.created',
  'run.clarification_required',
  'run.clarification_submitted',
  'run.status_changed',
  'domains.approval_required',
  'domains.approved',
  'address.approval_required',
  'address.granted',
  'seat_hold.approval_required',
  'seat_hold.approved',
  'merchant.attempt_started',
  'merchant.attempt_completed',
  'offer.recorded',
  'coupon.attempted',
  'evidence.captured',
  'run.warning',
  'control.claimed',
  'control.renewed',
  'control.released',
  'control.lease_expired',
  'report.updated',
  'run.completed',
  'run.cancelled',
  'run.failed',
  'stream.reset_required',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const INTERNAL_COMMANDS = [
  'clarify',
  'pause',
  'resume',
  'cancel',
  'complete',
  'approve_domains',
  'grant_address',
  'approve_seat_hold',
] as const;

export type InternalCommandName = (typeof INTERNAL_COMMANDS)[number];

export interface EventEnvelope {
  id: string;
  runId: string;
  type: EventType;
  status: ShoppingRunState;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface PriceBreakdown {
  itemSubtotal: string;
  deliveryFee: string | null;
  serviceFee: string | null;
  bookingFee: string | null;
  tax: string | null;
  mandatoryFees: Array<{
    label: string;
    amount: string;
    evidenceIds: string[];
  }>;
  verifiedDiscount: string;
  optionalTip: '0.00' | null;
  finalTotal: string | null;
}

export const TERMINAL_RUN_STATES = new Set<ShoppingRunState>([
  ShoppingRunState.Completed,
  ShoppingRunState.Cancelled,
  ShoppingRunState.Failed,
]);

export const NON_PAUSED_NON_TERMINAL_STATES = new Set<ShoppingRunState>([
  ShoppingRunState.Clarifying,
  ShoppingRunState.Discovering,
  ShoppingRunState.AwaitingDomainApproval,
  ShoppingRunState.Comparing,
  ShoppingRunState.AwaitingAddressConsent,
  ShoppingRunState.AwaitingSeatHoldApproval,
  ShoppingRunState.CouponTesting,
  ShoppingRunState.ReadyForHandoff,
  ShoppingRunState.UserTakeover,
]);
