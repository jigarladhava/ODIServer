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
        if (pausedRef.current) {
          pendingRef.current[tagId] = value;
          return;
        }
        const trend = trendOf(valuesRef.current[tagId], value);
        if (trend) setTrends((t) => ({ ...t, [tagId]: trend }));
        valuesRef.current = { ...valuesRef.current, [tagId]: value };
        setValues(valuesRef.current);
      },
      onStateChange: setConnected,
    });
    return unsubscribe;
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
