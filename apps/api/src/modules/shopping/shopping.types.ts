export enum ShoppingCategory {
  Retail = 'retail',
  Food = 'food',
  Cinema = 'cinema',
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
  Completed = 'completed',
  Paused = 'paused',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export enum ApprovalType {
  DomainAccess = 'domain_access',
  AddressShare = 'address_share',
  SeatHold = 'seat_hold',
}

export enum ViewerMode {
  View = 'view',
  Control = 'control',
}

export enum RunControlAction {
  Pause = 'pause',
  Resume = 'resume',
  TakeControl = 'take_control',
  ReleaseControl = 'release_control',
  Complete = 'complete',
  Cancel = 'cancel',
}

export enum AiEventType {
  StateChanged = 'run.state_changed',
  MerchantAttempted = 'merchant.attempted',
  OfferNormalized = 'offer.normalized',
  CouponAttempted = 'coupon.attempted',
  EvidenceCaptured = 'evidence.captured',
  RunFailed = 'run.failed',
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

export interface MerchantCatalogEntry {
  name: string;
  domain: string;
  category: ShoppingCategory;
  market: 'EG';
  currency: 'EGP';
}

export const EGYPT_MERCHANTS: readonly MerchantCatalogEntry[] = [
  {
    name: 'Amazon Egypt',
    domain: 'amazon.eg',
    category: ShoppingCategory.Retail,
    market: 'EG',
    currency: 'EGP',
  },
  {
    name: 'Jumia Egypt',
    domain: 'jumia.com.eg',
    category: ShoppingCategory.Retail,
    market: 'EG',
    currency: 'EGP',
  },
  {
    name: 'Noon Egypt',
    domain: 'noon.com',
    category: ShoppingCategory.Retail,
    market: 'EG',
    currency: 'EGP',
  },
  {
    name: 'Talabat Egypt',
    domain: 'talabat.com',
    category: ShoppingCategory.Food,
    market: 'EG',
    currency: 'EGP',
  },
  {
    name: 'VOX Egypt',
    domain: 'voxcinemas.com',
    category: ShoppingCategory.Cinema,
    market: 'EG',
    currency: 'EGP',
  },
] as const;

export const TERMINAL_RUN_STATES = new Set<ShoppingRunState>([
  ShoppingRunState.Completed,
  ShoppingRunState.Failed,
  ShoppingRunState.Cancelled,
]);
