import { apiClient } from '@/api/client';
import {
  clearTemporaryAddress,
  EgyptAddressProfile,
  loadEgyptAddress,
} from './address';
import {
  ApprovalType,
  ControlTokenResponse,
  CreateShoppingRunRequest,
  RunEvent,
  ShoppingCandidate,
  ShoppingReport,
  ShoppingRunSnapshot,
} from './types';

const RUNS_PATH = '/api/v1/shopping/runs';

function list<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeRunSnapshot(
  value: Partial<ShoppingRunSnapshot> & Pick<ShoppingRunSnapshot, 'id'>,
): ShoppingRunSnapshot {
  return {
    id: value.id,
    category: value.category ?? 'retail',
    status: value.status ?? 'queued',
    eventStreamUrl: value.eventStreamUrl,
    remoteViewerUrl: value.remoteViewerUrl,
    events: list(value.events),
    approvals: list(value.approvals),
    warnings: list(value.warnings),
    partialResults: list(value.partialResults),
    screenshots: list(value.screenshots),
    reportAvailable: value.reportAvailable ?? false,
  };
}

export async function createShoppingRun(
  request: CreateShoppingRunRequest,
): Promise<ShoppingRunSnapshot> {
  const { data } = await apiClient.post<ShoppingRunSnapshot>(
    RUNS_PATH,
    request,
  );
  return normalizeRunSnapshot(data);
}

export async function getShoppingRun(
  runId: string,
): Promise<ShoppingRunSnapshot> {
  const { data } = await apiClient.get<ShoppingRunSnapshot>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}`,
  );
  return normalizeRunSnapshot(data);
}

export async function decideApproval(
  runId: string,
  approvalId: string,
  type: Exclude<ApprovalType, 'address_share'>,
  decision: 'approved' | 'declined',
): Promise<ShoppingRunSnapshot> {
  const { data } = await apiClient.post<ShoppingRunSnapshot>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
    { type, decision },
  );
  return normalizeRunSnapshot(data);
}

export async function declineAddressShare(
  runId: string,
  approvalId: string,
  merchantId: string,
): Promise<ShoppingRunSnapshot> {
  const { data } = await apiClient.post<ShoppingRunSnapshot>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
    { type: 'address_share', decision: 'declined', merchantId },
  );
  return normalizeRunSnapshot(data);
}

export async function shareAddressAfterExplicitConsent(
  runId: string,
  approvalId: string,
  merchantId: string,
  ownerId: string,
  consent: true,
): Promise<ShoppingRunSnapshot> {
  let storedAddress: EgyptAddressProfile | null = null;
  let transmissionCopy: EgyptAddressProfile | null = null;
  try {
    storedAddress = await loadEgyptAddress(ownerId);
    if (!storedAddress) throw new Error('ADDRESS_PROFILE_MISSING');
    transmissionCopy = { ...storedAddress };
    const { data } = await apiClient.post<ShoppingRunSnapshot>(
      `${RUNS_PATH}/${encodeURIComponent(runId)}/address-share`,
      {
        approvalId,
        merchantId,
        consent,
        address: transmissionCopy,
      },
    );
    return normalizeRunSnapshot(data);
  } catch (reason) {
    if (
      reason instanceof Error &&
      reason.message === 'ADDRESS_PROFILE_MISSING'
    ) {
      throw reason;
    }
    // Do not let an Axios error retain a request config containing address data.
    throw new Error('ADDRESS_SHARE_FAILED');
  } finally {
    clearTemporaryAddress(transmissionCopy);
    clearTemporaryAddress(storedAddress);
    transmissionCopy = null;
    storedAddress = null;
  }
}

export async function sendRunAction(
  runId: string,
  action: 'pause' | 'resume' | 'cancel',
): Promise<ShoppingRunSnapshot> {
  const { data } = await apiClient.post<ShoppingRunSnapshot>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/actions`,
    { action },
  );
  return normalizeRunSnapshot(data);
}

export async function requestControlToken(
  runId: string,
): Promise<ControlTokenResponse> {
  const { data } = await apiClient.post<ControlTokenResponse>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/control-token`,
  );
  return data;
}

export async function releaseControlToken(runId: string): Promise<void> {
  await apiClient.post(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/control/release`,
  );
}

function normalizeCandidate(candidate: ShoppingCandidate): ShoppingCandidate {
  return {
    ...candidate,
    rating: candidate.rating ?? null,
    breakdown: {
      subtotal: candidate.breakdown?.subtotal ?? null,
      delivery: candidate.breakdown?.delivery ?? null,
      serviceFee: candidate.breakdown?.serviceFee ?? null,
      taxes: candidate.breakdown?.taxes ?? null,
      discount: candidate.breakdown?.discount ?? null,
      total: candidate.breakdown?.total ?? null,
    },
    incompleteReason: candidate.incompleteReason ?? null,
    verifiedAt: candidate.verifiedAt ?? null,
  };
}

export async function getShoppingReport(
  runId: string,
): Promise<ShoppingReport> {
  const { data } = await apiClient.get<ShoppingReport>(
    `${RUNS_PATH}/${encodeURIComponent(runId)}/report`,
  );
  return {
    runId: data.runId ?? runId,
    category: data.category ?? 'retail',
    checkedAt: data.checkedAt ?? null,
    candidates: list(data.candidates).map(normalizeCandidate),
  };
}

export function mergeRunEvent(
  current: ShoppingRunSnapshot,
  event: RunEvent,
): ShoppingRunSnapshot {
  const events = current.events.some((item) => item.id === event.id)
    ? current.events
    : [...current.events, event];
  return { ...current, events };
}
