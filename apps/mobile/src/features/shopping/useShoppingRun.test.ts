import { act, renderHook } from '@testing-library/react-native';
import {
  createViewerToken,
  eventWebSocketUrl,
  getRunEventHistory,
  getShoppingRun,
} from './shopping.service';
import { RunResource } from './types';
import { useShoppingRun } from './useShoppingRun';

jest.mock('./shopping.service', () => {
  const actual = jest.requireActual('./shopping.service');
  return {
    ...actual,
    createViewerToken: jest.fn(),
    eventWebSocketUrl: jest.fn(),
    getRunEventHistory: jest.fn(),
    getShoppingRun: jest.fn(),
  };
});

const getRun = getShoppingRun as jest.MockedFunction<typeof getShoppingRun>;
const getHistory = getRunEventHistory as jest.MockedFunction<
  typeof getRunEventHistory
>;
const getViewer = createViewerToken as jest.MockedFunction<
  typeof createViewerToken
>;
const socketUrl = eventWebSocketUrl as jest.MockedFunction<
  typeof eventWebSocketUrl
>;

const run: RunResource = {
  id: 'run-hook',
  requestedCategory: 'auto',
  category: null,
  market: 'EG',
  currency: 'EGP',
  timezone: 'Africa/Cairo',
  locale: 'ar-EG',
  query: 'طلب اختبار',
  status: 'clarifying',
  resumeStatus: null,
  pendingAction: {
    type: 'clarification',
    requestId: 'request-1',
    questions: [{ id: 'kind', prompt: 'ماذا تريد؟', required: true }],
  },
  failure: null,
  createdAt: '2026-07-17T12:00:00.000Z',
  updatedAt: '2026-07-17T12:00:00.000Z',
  completedAt: null,
  browserExpiresAt: '2026-07-17T13:00:00.000Z',
  lastEventId: null,
};

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(
    public readonly url: string,
    public readonly protocols: string[],
  ) {
    FakeWebSocket.instances.push(this);
  }

  close() {}

  emitMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  emitClose(code = 1006) {
    this.onclose?.({ code });
  }
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useShoppingRun canonical event stream', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    FakeWebSocket.instances = [];
    Object.defineProperty(global, 'WebSocket', {
      configurable: true,
      value: FakeWebSocket,
    });
    getRun.mockResolvedValue(run);
    getHistory.mockResolvedValue({
      events: [],
      nextAfter: null,
      hasMore: false,
    });
    getViewer.mockResolvedValue({
      token: 'viewer-secret',
      tokenType: 'Bearer',
      mode: 'view',
      viewerUrl: 'https://demo.example/viewer/',
      expiresAt: run.browserExpiresAt,
    });
    socketUrl.mockReturnValue(
      'wss://demo.example/api/v1/shopping/runs/run-hook/events',
    );
  });

  afterEach(() => jest.useRealTimers());

  it('authenticates via subprotocol, deduplicates history frames, and polls after three failures', async () => {
    const hook = renderHook(() => useShoppingRun(run.id));
    await flushPromises();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).not.toContain('viewer-secret');
    expect(FakeWebSocket.instances[0].protocols).toEqual([
      'dealpilot.events.v1',
      'bearer.viewer-secret',
    ]);

    const event = {
      id: 'event-1',
      runId: run.id,
      type: 'run.warning',
      status: 'clarifying',
      timestamp: run.updatedAt,
      payload: {
        code: 'TEST_WARNING',
        message: 'Fixture warning',
        merchantAttemptId: null,
        evidenceIds: [],
      },
    } as const;
    act(() => {
      FakeWebSocket.instances[0].emitMessage(event);
      FakeWebSocket.instances[0].emitMessage(event);
    });
    expect(hook.result.current.snapshot?.events).toHaveLength(1);

    act(() => FakeWebSocket.instances[0].emitClose());
    await act(async () => jest.advanceTimersByTime(1_000));
    await flushPromises();
    expect(FakeWebSocket.instances).toHaveLength(2);

    act(() => FakeWebSocket.instances[1].emitClose());
    await act(async () => jest.advanceTimersByTime(2_000));
    await flushPromises();
    expect(FakeWebSocket.instances).toHaveLength(3);

    act(() => FakeWebSocket.instances[2].emitClose());
    await flushPromises();
    expect(hook.result.current.connection).toBe('polling');
    expect(getRun).toHaveBeenCalled();

    hook.unmount();
  });
});
