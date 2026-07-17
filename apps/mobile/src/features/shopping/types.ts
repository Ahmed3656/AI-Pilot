import { AppLocale } from '@/localization';

export type ShoppingCategory = 'retail' | 'food' | 'cinema';
export type CategorySelection = ShoppingCategory | 'auto';
export type RunStatus =
  'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';

export interface CreateShoppingRunRequest {
  market: 'EG';
  currency: 'EGP';
  locale: AppLocale;
  category: CategorySelection;
  request: string;
  clarification: Record<string, string>;
}

export type ApprovalType = 'merchant' | 'address_share' | 'seat_hold';

export interface MerchantIdentity {
  id: string;
  name: string;
  branch?: string;
}

export interface RunApproval {
  id: string;
  type: ApprovalType;
  status: 'pending' | 'approved' | 'declined' | 'expired';
  merchant: MerchantIdentity;
  summary?: string;
  expiresAt?: string;
}

export type RunEventType =
  | 'status'
  | 'merchant'
  | 'approval'
  | 'coupon'
  | 'screenshot'
  | 'warning'
  | 'partial_result';

export interface RunEvent {
  id: string;
  type: RunEventType;
  title: string;
  message?: string;
  createdAt: string;
  severity?: 'info' | 'success' | 'warning' | 'error';
  status?: 'trying' | 'applied' | 'rejected';
  imageUrl?: string;
}

export interface RunScreenshot {
  id: string;
  imageUrl: string;
  merchantName: string;
  capturedAt: string;
}

export interface ShoppingRunSnapshot {
  id: string;
  category: ShoppingCategory;
  status: RunStatus;
  eventStreamUrl?: string;
  remoteViewerUrl?: string;
  events: RunEvent[];
  approvals: RunApproval[];
  warnings: string[];
  partialResults: string[];
  screenshots: RunScreenshot[];
  reportAvailable: boolean;
}

export interface TotalBreakdown {
  subtotal: number | null;
  delivery: number | null;
  serviceFee: number | null;
  taxes: number | null;
  discount: number | null;
  total: number | null;
}

export interface ShoppingCandidate {
  id: string;
  category: ShoppingCategory;
  merchant: string;
  title: string;
  detail?: string;
  rating?: number | null;
  venue?: string;
  showtime?: string;
  breakdown: TotalBreakdown;
  isComplete: boolean;
  incompleteReason: string | null;
  verifiedAt: string | null;
}

export interface ShoppingReport {
  runId: string;
  category: ShoppingCategory;
  checkedAt: string | null;
  candidates: ShoppingCandidate[];
}

export interface ControlTokenResponse {
  controlToken: string;
  viewerUrl: string;
  expiresAt: string;
}

export interface TimelineEnvelope {
  event: RunEvent;
  snapshot?: ShoppingRunSnapshot;
}
