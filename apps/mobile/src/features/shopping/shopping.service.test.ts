import { apiClient } from '@/api/client';
import { clearTemporaryAddress, loadEgyptAddress } from './address';
import {
  ActiveShoppingRunError,
  approveDomains,
  claimControl,
  createShoppingRun,
  createViewerToken,
  eventWebSocketUrl,
  getRunEventHistory,
  normalizeRunResource,
  replaceActiveShoppingRun,
  releaseControl,
  shareAddressAfterExplicitConsent,
  submitClarification,
  ShoppingBrowserBusyError,
} from './shopping.service';
import { RunResource } from './types';

jest.mock('@/api/client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('./address', () => ({
  loadEgyptAddress: jest.fn(),
  clearTemporaryAddress: jest.fn(),
}));

const post = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const get = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const loadAddress = loadEgyptAddress as jest.MockedFunction<
  typeof loadEgyptAddress
>;
const clearAddress = clearTemporaryAddress as jest.MockedFunction<
  typeof clearTemporaryAddress
>;

const run: RunResource = {
  id: 'run-01',
  requestedCategory: 'auto',
  category: 'retail',
  market: 'EG',
  currency: 'EGP',
  timezone: 'Africa/Cairo',
  locale: 'en-EG',
  query: 'Samsung A55',
  status: 'discovering',
  resumeStatus: null,
  pendingAction: null,
  failure: null,
  createdAt: '2026-07-17T12:00:00.000Z',
  updatedAt: '2026-07-17T12:00:00.000Z',
  completedAt: null,
  browserExpiresAt: '2026-07-17T13:00:00.000Z',
  lastEventId: null,
};

beforeEach(() => jest.clearAllMocks());

describe('canonical shopping service', () => {
  it('creates a run with only query, locale, and the auto/manual category', async () => {
    post.mockResolvedValueOnce({ data: { run } });

    await createShoppingRun({
      query: 'Samsung A55',
      category: 'auto',
      locale: 'en-EG',
    });

    expect(post).toHaveBeenCalledWith(
      '/shopping/runs',
      {
        query: 'Samsung A55',
        category: 'auto',
        locale: 'en-EG',
      },
      {
        headers: {
          'Idempotency-Key': expect.stringMatching(/^mobile-.{8,}$/),
        },
      },
    );
  });

  it('turns the active-run API contract into an actionable run ID', async () => {
    post.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          error: {
            code: 'ACTIVE_RUN_EXISTS',
            details: [
              {
                field: 'runId',
                code: 'ACTIVE_RUN',
                message: run.id,
              },
            ],
          },
        },
      },
    });

    await expect(
      createShoppingRun({
        query: 'Start a new request',
        category: 'retail',
        locale: 'en-EG',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ActiveShoppingRunError>>({
        runId: run.id,
      }),
    );
  });

  it('distinguishes a browser-busy response from a connection failure', async () => {
    post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 429, data: { error: { code: 'BROWSER_BUSY' } } },
    });

    await expect(
      createShoppingRun({
        query: 'Start a new request',
        category: 'retail',
        locale: 'en-EG',
      }),
    ).rejects.toBeInstanceOf(ShoppingBrowserBusyError);
  });

  it('cancels the old run before creating its replacement', async () => {
    const replacement = { ...run, id: 'run-02', query: 'New request' };
    post
      .mockResolvedValueOnce({ data: { run: { ...run, status: 'cancelled' } } })
      .mockResolvedValueOnce({ data: { run: replacement } });

    const created = await replaceActiveShoppingRun(run.id, {
      query: replacement.query,
      category: 'retail',
      locale: 'en-EG',
    });

    expect(created.id).toBe(replacement.id);
    expect(post.mock.calls[0][0]).toBe('/shopping/runs/run-01/control');
    expect(post.mock.calls[0][1]).toEqual({
      action: 'cancel',
      reason: 'replaced_by_new_run',
    });
    expect(post.mock.calls[1][0]).toBe('/shopping/runs');
  });

  it('rejects an unknown status instead of defaulting it', () => {
    expect(() => normalizeRunResource({ ...run, status: 'queued' })).toThrow(
      'UNKNOWN_RUN_STATUS:queued',
    );
  });

  it('uses the canonical clarification and selected-domain endpoints', async () => {
    post.mockResolvedValueOnce({ data: { run } }).mockResolvedValueOnce({
      data: {
        run,
        approval: {
          id: 'approval-1',
          runId: run.id,
          requestId: 'request-2',
          type: 'domain_access',
          merchantDomains: ['amazon.eg'],
          offerId: null,
          status: 'approved',
          approvedAt: run.updatedAt,
          expiresAt: null,
        },
      },
    });

    await submitClarification(run.id, 'request-1', { model: 'A55' });
    await approveDomains(run.id, 'request-2', ['amazon.eg']);

    expect(post.mock.calls[0][0]).toBe('/shopping/runs/run-01/clarifications');
    expect(post.mock.calls[0][1]).toEqual({
      requestId: 'request-1',
      answers: { model: 'A55' },
    });
    expect(post.mock.calls[1][0]).toBe('/shopping/runs/run-01/domains/approve');
    expect(post.mock.calls[1][1]).toEqual({
      requestId: 'request-2',
      domains: ['amazon.eg'],
    });
  });

  it('grants the canonical cityOrArea address and clears temporary copies', async () => {
    loadAddress.mockResolvedValueOnce({
      recipientName: 'Test Recipient',
      mobileNumber: '01012345678',
      governorate: 'Cairo',
      cityOrArea: 'Nasr City',
      street: 'Test Street',
      building: '10',
      floor: '2',
      apartment: '4',
      landmark: 'Test landmark',
      postalCode: '',
    });
    post.mockResolvedValueOnce({
      data: {
        run,
        approval: {
          id: 'approval-address',
          runId: run.id,
          requestId: 'request-address',
          type: 'address_share',
          merchantDomains: ['amazon.eg'],
          offerId: null,
          status: 'approved',
          approvedAt: run.updatedAt,
          expiresAt: run.browserExpiresAt,
        },
      },
    });

    await shareAddressAfterExplicitConsent(
      run.id,
      'request-address',
      ['amazon.eg'],
      'owner-1',
    );

    expect(post).toHaveBeenCalledWith(
      '/shopping/runs/run-01/address-grant',
      {
        requestId: 'request-address',
        merchantDomains: ['amazon.eg'],
        address: {
          recipientName: 'Test Recipient',
          mobileNumber: '01012345678',
          governorate: 'Cairo',
          cityOrArea: 'Nasr City',
          street: 'Test Street',
          building: '10',
          floor: '2',
          apartment: '4',
          landmark: 'Test landmark',
        },
      },
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(clearAddress).toHaveBeenCalledTimes(2);
  });

  it('claims control, creates the exact control token payload, and releases by lease', async () => {
    const lease = {
      id: 'lease-1',
      runId: run.id,
      holderUserId: 'user-1',
      status: 'active' as const,
      claimedAt: run.updatedAt,
      renewedAt: run.updatedAt,
      expiresAt: run.browserExpiresAt,
    };
    post
      .mockResolvedValueOnce({ data: { run, lease } })
      .mockResolvedValueOnce({
        data: {
          token: 'viewer-secret',
          tokenType: 'Bearer',
          mode: 'control',
          viewerUrl: 'http://localhost:8080/viewer/',
          expiresAt: run.browserExpiresAt,
        },
      })
      .mockResolvedValueOnce({
        data: { run, lease: { ...lease, status: 'released' } },
      });

    await claimControl(run.id);
    await createViewerToken(run.id, 'control', lease.id);
    await releaseControl(run.id, lease.id);

    expect(post.mock.calls.map(([path]) => path)).toEqual([
      '/shopping/runs/run-01/control/claim',
      '/shopping/runs/run-01/viewer-tokens',
      '/shopping/runs/run-01/control/release',
    ]);
    expect(post.mock.calls[1][1]).toEqual({
      mode: 'control',
      leaseId: 'lease-1',
    });
    expect(post.mock.calls[2][1]).toEqual({ leaseId: 'lease-1' });
  });

  it('rejects a viewer URL that leaks credentials in its query string', async () => {
    post.mockResolvedValueOnce({
      data: {
        token: 'viewer-secret',
        tokenType: 'Bearer',
        mode: 'view',
        viewerUrl: 'http://localhost:8080/viewer/?token=viewer-secret',
        expiresAt: run.browserExpiresAt,
      },
    });

    await expect(createViewerToken(run.id, 'view')).rejects.toThrow(
      'INVALID_VIEWER_TOKEN_RESPONSE',
    );
  });

  it('aligns a local development viewer with the API host used by the website', async () => {
    post.mockResolvedValueOnce({
      data: {
        token: 'viewer-secret',
        tokenType: 'Bearer',
        mode: 'view',
        viewerUrl: 'http://192.168.1.9:8080/viewer/',
        expiresAt: run.browserExpiresAt,
      },
    });

    await expect(createViewerToken(run.id, 'view')).resolves.toMatchObject({
      viewerUrl: 'http://localhost:8080/viewer/',
    });
  });

  it('does not align an untrusted viewer origin in development', async () => {
    post.mockResolvedValueOnce({
      data: {
        token: 'viewer-secret',
        tokenType: 'Bearer',
        mode: 'view',
        viewerUrl: 'https://attacker.example/viewer/',
        expiresAt: run.browserExpiresAt,
      },
    });

    await expect(createViewerToken(run.id, 'view')).rejects.toThrow(
      'INVALID_VIEWER_TOKEN_RESPONSE',
    );
  });

  it('parses canonical event history and keeps viewer tokens out of WebSocket URLs', async () => {
    get.mockResolvedValueOnce({
      data: {
        events: [
          {
            id: 'event-1',
            runId: run.id,
            type: 'merchant.attempt_started',
            status: 'comparing',
            timestamp: run.updatedAt,
            payload: {
              attemptId: 'attempt-1',
              merchantId: 'amazon-eg',
              merchantDomain: 'amazon.eg',
              category: 'retail',
            },
          },
        ],
        nextAfter: 'event-1',
        hasMore: false,
      },
    });

    const history = await getRunEventHistory(run.id, 'event-0');
    const socketUrl = eventWebSocketUrl(run.id, 'event-1');

    expect(history.events[0].type).toBe('merchant.attempt_started');
    expect(get).toHaveBeenCalledWith('/shopping/runs/run-01/events', {
      params: { after: 'event-0', limit: 200 },
    });
    expect(socketUrl).toContain('/api/v1/shopping/runs/run-01/events');
    expect(socketUrl).toContain('after=event-1');
    expect(socketUrl).not.toContain('token');
    expect(socketUrl).not.toContain('viewer-secret');
  });
});
