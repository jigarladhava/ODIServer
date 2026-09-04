import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getValues, subscribeValues } from './api-client';
import type { TagValue, ValueMap } from './types';

export type Trend = 'up' | 'down' | 'flat';

/**
 * WS change messages are coalesced and applied at most once per this window.
 * Chatty servers (thousands of tags flapping quality during device outages)
 * otherwise re-render the whole app hundreds of times per second and freeze
 * the console main thread; 200ms is well below human-perceptible latency.
 */
const CHANGE_FLUSH_MS = 200;

interface LiveValuesContextValue {
  /** Latest known value per tag id (initial REST snapshot + WS updates). */
  values: ValueMap;
  /** Value direction since the previous update, per tag id. */
  trends: Record<string, Trend>;
  /** Whether the /ws stream is currently connected. */
  connected: boolean;
  /** When paused, incoming changes are buffered, not applied. */
  paused: boolean;
  setPaused: (paused: boolean) => void;
}

const LiveValuesContext = createContext<LiveValuesContextValue | null>(null);

function trendOf(prev: TagValue | undefined, next: TagValue): Trend | undefined {
  if (typeof prev?.value !== 'number' || typeof next.value !== 'number') return undefined;
  if (next.value > prev.value) return 'up';
  if (next.value < prev.value) return 'down';
  return 'flat';
}

export function LiveValuesProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<ValueMap>({});
  const [trends, setTrends] = useState<Record<string, Trend>>({});
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  // Changes arriving while paused are merged here and flushed on resume, so
  // resuming shows the current values rather than stale ones.
  const pendingRef = useRef<ValueMap>({});
  const pausedRef = useRef(false);
  const valuesRef = useRef<ValueMap>({});

  const updatePaused = (next: boolean) => {
    pausedRef.current = next;
    setPaused(next);
    if (!next && Object.keys(pendingRef.current).length > 0) {
      const flush = pendingRef.current;
      pendingRef.current = {};
      valuesRef.current = { ...valuesRef.current, ...flush };
      setValues(valuesRef.current);
    }
  };

  useEffect(() => {
    let flushTimer: number | undefined;

    const commitPending = () => {
      flushTimer = undefined;
      if (pausedRef.current) return;
      const batch = pendingRef.current;
      if (Object.keys(batch).length === 0) return;
      pendingRef.current = {};
      valuesRef.current = { ...valuesRef.current, ...batch };
      setValues(valuesRef.current);
    };

    // Initial snapshot over REST as a fallback; the WS snapshot replaces it.
    getValues()
      .then((snapshot) => {
        valuesRef.current = snapshot;
        setValues(snapshot);
      })
      .catch(() => {
        // backend unreachable — the WS reconnect loop keeps retrying
      });
    const unsubscribe = subscribeValues({
      onSnapshot: (snapshot) => {
        valuesRef.current = snapshot;
        setValues(snapshot);
      },
      onChange: (change) => {
        const { tagId, ...value } = change;
        // Buffer while paused, same as before.
        if (pausedRef.current) {
          pendingRef.current[tagId] = value;
          return;
        }
        // Trend against the newest value seen (batch included), not the last
        // committed one, so bursts of changes still produce correct arrows.
        const trend = trendOf(pendingRef.current[tagId] ?? valuesRef.current[tagId], value);
        if (trend) setTrends((t) => ({ ...t, [tagId]: trend }));
        pendingRef.current[tagId] = value;
        // Coalesce bursts: one React state update per flush window, not one
        // per WS message. The value map is a ref, so live cells read the
        // latest data regardless; only the re-render cadence is throttled.
        if (flushTimer === undefined) {
          flushTimer = window.setTimeout(commitPending, CHANGE_FLUSH_MS);
        }
      },
      onStateChange: setConnected,
    });
    return () => {
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({ values, trends, connected, paused, setPaused: updatePaused }),
    [values, trends, connected, paused],
  );
  return <LiveValuesContext.Provider value={value}>{children}</LiveValuesContext.Provider>;
}

export function useTagValues(): LiveValuesContextValue {
  const ctx = useContext(LiveValuesContext);
  if (!ctx) throw new Error('useTagValues must be used within LiveValuesProvider');
  return ctx;
}
