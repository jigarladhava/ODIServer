import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getValues, subscribeValues } from './api-client';
import type { ValueMap } from './types';

interface LiveValuesContextValue {
  /** Latest known value per tag id (initial REST snapshot + WS updates). */
  values: ValueMap;
  /** Whether the /ws stream is currently connected. */
  connected: boolean;
}

const LiveValuesContext = createContext<LiveValuesContextValue | null>(null);

export function LiveValuesProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<ValueMap>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Initial snapshot over REST as a fallback; the WS snapshot replaces it.
    getValues()
      .then(setValues)
      .catch(() => {
        // backend unreachable — the WS reconnect loop keeps retrying
      });
    const unsubscribe = subscribeValues({
      onSnapshot: setValues,
      onChange: (change) => {
        const { tagId, ...value } = change;
        setValues((prev) => ({ ...prev, [tagId]: value }));
      },
      onStateChange: setConnected,
    });
    return unsubscribe;
  }, []);

  const value = useMemo(() => ({ values, connected }), [values, connected]);
  return <LiveValuesContext.Provider value={value}>{children}</LiveValuesContext.Provider>;
}

export function useTagValues(): LiveValuesContextValue {
  const ctx = useContext(LiveValuesContext);
  if (!ctx) throw new Error('useTagValues must be used within LiveValuesProvider');
  return ctx;
}
