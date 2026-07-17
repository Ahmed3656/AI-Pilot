import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getShoppingRun,
  mergeRunEvent,
  normalizeRunSnapshot,
} from './shopping.service';
import { ShoppingRunSnapshot, TimelineEnvelope } from './types';

export type RunConnectionState =
  'connecting' | 'live' | 'reconnecting' | 'polling' | 'offline';

const POLL_INTERVAL_MS = 5_000;
const MAX_SOCKET_FAILURES = 3;

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

  const refresh = useCallback(async () => {
    const next = await getShoppingRun(runId);
    applySnapshot(next);
    return next;
  }, [applySnapshot, runId]);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let socketFailures = 0;

    const poll = async () => {
      try {
        const next = await getShoppingRun(runId);
        if (!stopped) applySnapshot(next);
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

    const connect = (eventStreamUrl: string) => {
      if (stopped) return;
      setConnection(socketFailures > 0 ? 'reconnecting' : 'connecting');
      socket = new WebSocket(eventStreamUrl);
      socket.onopen = () => {
        if (!stopped) setConnection('live');
      };
      socket.onmessage = (message) => {
        try {
          const envelope = JSON.parse(String(message.data)) as TimelineEnvelope;
          socketFailures = 0;
          if (envelope.snapshot) {
            applySnapshot(normalizeRunSnapshot(envelope.snapshot));
          } else if (envelope.event && snapshotRef.current) {
            applySnapshot(mergeRunEvent(snapshotRef.current, envelope.event));
          }
        } catch {
          // Ignore malformed frames and keep the last trusted snapshot.
        }
      };
      socket.onerror = () => {
        socket?.close();
      };
      socket.onclose = () => {
        socket = null;
        if (stopped) return;
        socketFailures += 1;
        if (socketFailures >= MAX_SOCKET_FAILURES) {
          startPolling();
          return;
        }
        setConnection('reconnecting');
        reconnectTimer = setTimeout(
          () => connect(eventStreamUrl),
          Math.min(1_000 * 2 ** socketFailures, 8_000),
        );
      };
    };

    const start = async () => {
      try {
        const initial = await getShoppingRun(runId);
        if (stopped) return;
        applySnapshot(initial);
        if (initial.eventStreamUrl) connect(initial.eventStreamUrl);
        else startPolling();
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
      socket?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [applySnapshot, runId]);

  return { snapshot, connection, error, refresh, applySnapshot };
}
