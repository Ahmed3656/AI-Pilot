import { apiClient } from '@/api/client';
import { environment } from '@/config/environment';
import {
  clearTemporaryAddress,
  EgyptAddressProfile,
  loadEgyptAddress,
} from './address';
import {
  ApprovalResource,
  ControlLease,
  CreateShoppingRunRequest,
  EventEnvelope,
  EventHistoryResponse,
  EventType,
  RunReport,
  RunResource,
  RUN_STATUSES,
  RunStatus,
  ShoppingRunSnapshot,
  ViewerTokenResponse,
} from './types';

const RUNS_PATH = '/shopping/runs';
const EVENT_TYPES: EventType[] = [
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
];

function mutationHeaders() {
  return { 'Idempotency-Key': createIdempotencyKey() };
}

export function createIdempotencyKey(): string {
  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function isRunStatus(value: unknown): value is RunStatus {
  return RUN_STATUSES.includes(value as RunStatus);
}

function isEventType(value: unknown): value is EventType {
  return EVENT_TYPES.includes(value as EventType);
}

export function normalizeRunResource(value: unknown): RunResource {
  if (!value || typeof value !== 'object') throw new Error('INVALID_RUN');
  const run = value as RunResource;
  if (!run.id || !isRunStatus(run.status)) {
    throw new Error(
      run.status && !isRunStatus(run.status)
        ? `UNKNOWN_RUN_STATUS:${String(run.status)}`
        : 'INVALID_RUN',
    );
  }
  if (
    run.market !== 'EG' ||
    run.currency !== 'EGP' ||
    run.timezone !== 'Africa/Cairo' ||
    !['ar-EG', 'en-EG'].includes(run.locale)
  ) {
    throw new Error('UNSUPPORTED_RUN_SCOPE');
  }
  if (
    !['auto', 'retail', 'food', 'cinema'].includes(run.requestedCategory) ||
    ![null, 'retail', 'food', 'cinema'].includes(run.category)
  ) {
    throw new Error('UNKNOWN_RUN_CATEGORY');
  }
  return run;
}

export function normalizeEventEnvelope(value: unknown): EventEnvelope {
  if (!value || typeof value !== 'object') throw new Error('INVALID_EVENT');
  const event = value as EventEnvelope;
  if (
    !event.id ||
    !event.runId ||
    !event.timestamp ||
    !isRunStatus(event.status) ||
    !isEventType(event.type) ||
    !event.payload ||
    typeof event.payload !== 'object'
  ) {
    throw new Error('INVALID_EVENT');
  }
  return event;
}

function unwrapRun(data: { run: unknown }): RunResource {
  return normalizeRunResource(data.run);
}

export async function createShoppingRun(
  request: CreateShoppingRunRequest,
): Promise<RunResource> {
  const { data } = await apiClient.post<{ run: unknown }>(RUNS_PATH, request, {
    headers: mutationHeaders(),
  });
  return unwrapRun(data);
}

export async function getShoppingRun(runId: string): Promise<RunResource> {
  const { data } = await apiClient.get<{ run: unknown }>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}`,
  );
  return unwrapRun(data);
}

export async function submitClarification(
  runId: string,
  requestId: string,
  answers: Record<string, string | string[]>,
): Promise<RunResource> {
  const { data } = await apiClient.post<{ run: unknown }>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/clarifications`,
    { requestId, answers },
    { headers: mutationHeaders() },
  );
  return unwrapRun(data);
}

export async function approveDomains(
  runId: string,
  requestId: string,
  domains: string[],
): Promise<{ run: RunResource; approval: ApprovalResource }> {
  const { data } = await apiClient.post<{
    run: unknown;
    approval: ApprovalResource;
  }>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/domains/approve`,
    { requestId, domains },
    { headers: mutationHeaders() },
  );
  return { run: unwrapRun(data), approval: data.approval };
}

function canonicalAddress(profile: EgyptAddressProfile) {
  const address = {
    recipientName: profile.recipientName,
    mobileNumber: profile.mobileNumber,
    governorate: profile.governorate,
    cityOrArea: profile.cityOrArea,
    street: profile.street,
    building: profile.building,
    floor: profile.floor,
    apartment: profile.apartment,
    landmark: profile.landmark,
    ...(profile.postalCode.trim() ? { postalCode: profile.postalCode } : {}),
  };
  return address;
}

export async function shareAddressAfterExplicitConsent(
  runId: string,
  requestId: string,
  merchantDomains: string[],
  ownerId: string,
): Promise<{ run: RunResource; approval: ApprovalResource }> {
  let storedAddress: EgyptAddressProfile | null = null;
  let transmissionCopy: EgyptAddressProfile | null = null;
  try {
    storedAddress = await loadEgyptAddress(ownerId);
    if (!storedAddress) throw new Error('ADDRESS_PROFILE_MISSING');
    transmissionCopy = { ...storedAddress };
    const { data } = await apiClient.post<{
      run: unknown;
      approval: ApprovalResource;
    }>(
      `${RUNS_PATH}/${encodeURIComponent(runId)}/address-grant`,
      {
        requestId,
        merchantDomains,
        address: canonicalAddress(transmissionCopy),
      },
      { headers: mutationHeaders() },
    );
    return { run: unwrapRun(data), approval: data.approval };
  } catch (reason) {
    if (
      reason instanceof Error &&
      reason.message === 'ADDRESS_PROFILE_MISSING'
    ) {
      throw reason;
    }
    // Axios errors retain request bodies. Replace them before they reach UI/logging.
    throw new Error('ADDRESS_GRANT_FAILED');
  } finally {
    clearTemporaryAddress(transmissionCopy);
    clearTemporaryAddress(storedAddress);
    transmissionCopy = null;
    storedAddress = null;
  }
}

export async function approveSeatHold(
  runId: string,
  requestId: string,
  offerId: string,
  merchantDomain: string,
): Promise<{ run: RunResource; approval: ApprovalResource }> {
  const { data } = await apiClient.post<{
    run: unknown;
    approval: ApprovalResource;
  }>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/seat-hold/approve`,
    { requestId, offerId, merchantDomain },
    { headers: mutationHeaders() },
  );
  return { run: unwrapRun(data), approval: data.approval };
}

export async function sendRunAction(
  runId: string,
  action: 'pause' | 'resume' | 'cancel' | 'complete',
  reason?: string,
): Promise<RunResource> {
  const body = {
    action,
    ...((action === 'pause' || action === 'cancel') && reason
      ? { reason }
      : {}),
  };
  const { data } = await apiClient.post<{ run: unknown }>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/control`,
    body,
    { headers: mutationHeaders() },
  );
  return unwrapRun(data);
}

export async function claimControl(
  runId: string,
  requestedLeaseSeconds?: number,
): Promise<{ run: RunResource; lease: ControlLease }> {
  const { data } = await apiClient.post<{
    run: unknown;
    lease: ControlLease;
  }>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/control/claim`,
    requestedLeaseSeconds ? { requestedLeaseSeconds } : {},
    { headers: mutationHeaders() },
  );
  return { run: unwrapRun(data), lease: data.lease };
}

export async function renewControl(
  runId: string,
  leaseId: string,
): Promise<ControlLease> {
  const { data } = await apiClient.post<{ lease: ControlLease }>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/control/renew`,
    { leaseId },
    { headers: mutationHeaders() },
  );
  return data.lease;
}

export async function releaseControl(
  runId: string,
  leaseId: string,
): Promise<{ run: RunResource; lease: ControlLease }> {
  const { data } = await apiClient.post<{
    run: unknown;
    lease: ControlLease;
  }>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/control/release`,
    { leaseId },
    { headers: mutationHeaders() },
  );
  return { run: unwrapRun(data), lease: data.lease };
}

export async function createViewerToken(
  runId: string,
  mode: 'view' | 'control',
  leaseId?: string,
): Promise<ViewerTokenResponse> {
  if (mode === 'control' && !leaseId) throw new Error('LEASE_ID_REQUIRED');
  if (mode === 'view' && leaseId) throw new Error('LEASE_ID_NOT_ALLOWED');
  const { data } = await apiClient.post<ViewerTokenResponse>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/viewer-tokens`,
    { mode, ...(mode === 'control' ? { leaseId } : {}) },
    { headers: mutationHeaders() },
  );
  const viewerUrl = new URL(data.viewerUrl);
  if (
    data.mode !== mode ||
    data.tokenType !== 'Bearer' ||
    !data.token ||
    viewerUrl.origin !== environment.apiOrigin ||
    !viewerUrl.pathname.startsWith('/viewer/') ||
    viewerUrl.search ||
    viewerUrl.hash
  ) {
    throw new Error('INVALID_VIEWER_TOKEN_RESPONSE');
  }
  return data;
}

export async function getRunEventHistory(
  runId: string,
  after?: string,
  limit = 200,
): Promise<EventHistoryResponse> {
  const { data } = await apiClient.get<EventHistoryResponse>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/events`,
    { params: { ...(after ? { after } : {}), limit } },
  );
  return {
    events: data.events.map(normalizeEventEnvelope),
    nextAfter: data.nextAfter,
    hasMore: data.hasMore,
  };
}

export function eventWebSocketUrl(runId: string, after?: string): string {
  const url = new URL(
    `${environment.apiBaseUrl}${RUNS_PATH}/${encodeURIComponent(runId)}/events`,
  );
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (after) url.searchParams.set('after', after);
  return url.toString();
}

export async function getShoppingReport(runId: string): Promise<RunReport> {
  const { data } = await apiClient.get<RunReport>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/report`,
  );
  if (
    data.runId !== runId ||
    data.market !== 'EG' ||
    data.currency !== 'EGP' ||
    data.timezone !== 'Africa/Cairo' ||
    !['in_progress', 'final'].includes(data.status)
  ) {
    throw new Error('INVALID_REPORT');
  }
  return data;
}

export function mergeRunEvent(
  current: ShoppingRunSnapshot,
  event: EventEnvelope,
): ShoppingRunSnapshot {
  if (event.runId !== current.id) throw new Error('EVENT_RUN_MISMATCH');
  const events = current.events.some((item) => item.id === event.id)
    ? current.events
    : [...current.events, event];
  return {
    ...current,
    status: event.status,
    lastEventId: event.id,
    events,
  };
}
