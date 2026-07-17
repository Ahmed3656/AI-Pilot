import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createViewerToken,
  eventWebSocketUrl,
  getRunEventHistory,
  getShoppingRun,
  mergeRunEvent,
  normalizeEventEnvelope,
} from './shopping.service';
import {
  EventEnvelope,
  EventType,
  RunResource,
  ShoppingRunSnapshot,
} from './types';

export type RunConnectionState =
  'connecting' | 'live' | 'reconnecting' | 'polling' | 'offline';

const POLL_INTERVAL_MS = 5_000;
const MAX_SOCKET_FAILURES = 3;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];
const SNAPSHOT_EVENT_TYPES = new Set<EventType>([
  'run.clarification_required',
  'run.clarification_submitted',
  'run.status_changed',
  'domains.approval_required',
  'domains.approved',
  'address.approval_required',
  'address.granted',
  'seat_hold.approval_required',
  'seat_hold.approved',
  'control.claimed',
  'control.released',
  'control.lease_expired',
  'run.completed',
  'run.cancelled',
  'run.failed',
]);

function withEvents(
  run: RunResource,
  events: EventEnvelope[],
): ShoppingRunSnapshot {
  return { ...run, events };
}

function appendEvents(
  current: EventEnvelope[],
  incoming: EventEnvelope[],
): EventEnvelope[] {
  const seen = new Set(current.map((event) => event.id));
  return [
    ...current,
    ...incoming.filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    }),
  ];
}

export function useShoppingRun(runId: string) {
  const [snapshot, setSnapshot] = useState<ShoppingRunSnapshot | null>(null);
  const [connection, setConnection] =
    useState<RunConnectionState>('connecting');
  const [error, setError] = useState<Error | null>(null);
  const snapshotRef = useRef<ShoppingRunSnapshot | null>(null);

  const applySnapshot = useCallback((next: ShoppingRunSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    setError(null);
  }, []);

  const applyRun = useCallback(
    (run: RunResource) => {
      applySnapshot(withEvents(run, snapshotRef.current?.events ?? []));
    },
    [applySnapshot],
  );

  const refresh = useCallback(async () => {
    const next = await getShoppingRun(runId);
    applyRun(next);
    return next;
  }, [applyRun, runId]);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let socketFailures = 0;
    let resetting = false;

    const loadHistory = async (after?: string) => {
      let cursor = after;
      let collected: EventEnvelope[] = [];
      do {
        const page = await getRunEventHistory(runId, cursor);
        collected = appendEvents(collected, page.events);
        cursor = page.nextAfter ?? undefined;
        if (!page.hasMore) break;
      } while (!stopped);
      return collected;
    };

    const refreshSnapshot = async () => {
      const run = await getShoppingRun(runId);
      if (!stopped) applyRun(run);
      return run;
    };

    const poll = async () => {
      try {
        const run = await getShoppingRun(runId);
        const current = snapshotRef.current;
        const incoming = await loadHistory(current?.lastEventId ?? undefined);
        if (stopped) return;
        applySnapshot(
          withEvents(run, appendEvents(current?.events ?? [], incoming)),
        );
      } catch (reason) {
        if (!stopped) {
          setError(reason instanceof Error ? reason : new Error('POLL_FAILED'));
          if (!snapshotRef.current) setConnection('offline');
        }
      }
    };

    const startPolling = () => {
      if (stopped || pollTimer) return;
      socket?.close();
      socket = null;
      setConnection('polling');
      void poll();
      pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    };

    const resetFromSnapshot = async () => {
      if (resetting || stopped) return;
      resetting = true;
      try {
        const [run, events] = await Promise.all([
          getShoppingRun(runId),
          loadHistory(),
        ]);
        if (!stopped) applySnapshot(withEvents(run, events));
      } catch (reason) {
        if (!stopped) {
          setError(
            reason instanceof Error ? reason : new Error('STREAM_RESET_FAILED'),
          );
          startPolling();
        }
      } finally {
        resetting = false;
      }
    };

    const connect = async () => {
      if (stopped) return;
      setConnection(socketFailures > 0 ? 'reconnecting' : 'connecting');
      try {
        const viewer = await createViewerToken(runId, 'view');
        if (stopped) return;
        const after = snapshotRef.current?.lastEventId ?? undefined;
        socket = new WebSocket(eventWebSocketUrl(runId, after), [
          'dealpilot.events.v1',
          `bearer.${viewer.token}`,
        ]);
        socket.onopen = () => {
          if (!stopped) setConnection('live');
        };
        socket.onmessage = (message) => {
          try {
            const event = normalizeEventEnvelope(
              JSON.parse(String(message.data)),
            );
            if (event.runId !== runId) throw new Error('EVENT_RUN_MISMATCH');
            socketFailures = 0;
            if (event.type === 'stream.reset_required') {
              void resetFromSnapshot();
              return;
            }
            const current = snapshotRef.current;
            if (current) applySnapshot(mergeRunEvent(current, event));
            if (SNAPSHOT_EVENT_TYPES.has(event.type)) {
              void refreshSnapshot().catch((reason) => {
                if (!stopped)
                  setError(
                    reason instanceof Error
                      ? reason
                      : new Error('RUN_REFRESH_FAILED'),
                  );
              });
            }
          } catch (reason) {
            if (!stopped) {
              setError(
                reason instanceof Error ? reason : new Error('INVALID_EVENT'),
              );
            }
          }
        };
        socket.onerror = () => socket?.close();
        socket.onclose = (closeEvent) => {
          socket = null;
          if (stopped) return;
          if (closeEvent.code === 4009) {
            void resetFromSnapshot();
            return;
          }
          socketFailures += 1;
          if (socketFailures >= MAX_SOCKET_FAILURES) {
            startPolling();
            return;
          }
          setConnection('reconnecting');
          const delay =
            RECONNECT_DELAYS_MS[
              Math.min(socketFailures - 1, RECONNECT_DELAYS_MS.length - 1)
            ];
          reconnectTimer = setTimeout(() => void connect(), delay);
        };
      } catch (reason) {
        if (stopped) return;
        setError(
          reason instanceof Error ? reason : new Error('SOCKET_AUTH_FAILED'),
        );
        socketFailures += 1;
        if (socketFailures >= MAX_SOCKET_FAILURES) {
          startPolling();
          return;
        }
        const delay =
          RECONNECT_DELAYS_MS[
            Math.min(socketFailures - 1, RECONNECT_DELAYS_MS.length - 1)
          ];
        reconnectTimer = setTimeout(() => void connect(), delay);
      }
    };

    const start = async () => {
      if (!runId) return;
      try {
        const run = await getShoppingRun(runId);
        const events = await loadHistory();
        if (stopped) return;
        applySnapshot(withEvents(run, events));
        void connect();
      } catch (reason) {
        if (stopped) return;
        setError(
          reason instanceof Error ? reason : new Error('RUN_LOAD_FAILED'),
        );
        startPolling();
      }
    };

    void start();
    return () => {
      stopped = true;
      socket?.close(1000);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [applyRun, applySnapshot, runId]);

  return { snapshot, connection, error, refresh, applyRun };
}
