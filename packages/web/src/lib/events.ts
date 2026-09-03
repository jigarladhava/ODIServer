import { useEffect, useState } from 'react';
import { getEvents, subscribeValues } from './api-client';
import type { ServerEvent } from './types';

/**
 * Live server event log: initial REST snapshot (refreshed on every WS
 * reconnect to close any gap) plus streamed events appended as they arrive.
 * Events are kept in chronological order and capped at `limit`.
 */
export function useServerEvents(limit = 500): { events: ServerEvent[] } {
  const [events, setEvents] = useState<ServerEvent[]>([]);

  useEffect(() => {
    let alive = true;

    const loadSnapshot = () => {
      getEvents({ limit })
        .then((snapshot) => {
          if (!alive) return;
          // Merge, don't replace: streamed events that arrived while this
          // fetch was in flight are newer than the snapshot tail.
          setEvents((prev) => {
            const tailId = snapshot[snapshot.length - 1]?.id ?? 0;
            const merged = [...snapshot, ...prev.filter((e) => e.id > tailId)];
            return merged.length > limit ? merged.slice(merged.length - limit) : merged;
          });
        })
        .catch(() => {
          // backend unreachable — the WS reconnect loop keeps retrying
        });
    };

    loadSnapshot();
    const unsubscribe = subscribeValues({
      // Refetch on (re)connect so events emitted while the socket was down
      // are not missed; the snapshot simply replaces local state.
      onStateChange: (connected) => {
        if (connected) loadSnapshot();
      },
      onEvent: (event) => {
        setEvents((prev) => {
          // Ids are monotonic; anything older than the tail is a duplicate.
          if (event.id <= (prev[prev.length - 1]?.id ?? 0)) return prev;
          const next = [...prev, event];
          return next.length > limit ? next.slice(next.length - limit) : next;
        });
      },
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [limit]);

  return { events };
}
