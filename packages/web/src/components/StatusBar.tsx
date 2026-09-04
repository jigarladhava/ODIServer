import { useEffect, useState } from 'react';
import { getStatus } from '../lib/api-client';
import { formatUptime } from '../lib/format';
import { useTagValues } from '../lib/live-values';
import type { ServerStatus } from '../lib/types';

export function StatusBar() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const { connected } = useTagValues();

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getStatus()
        .then((s) => {
          if (cancelled) return;
          setStatus(s);
          setUnreachable(false);
        })
        .catch(() => {
          if (!cancelled) setUnreachable(true);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const running = !unreachable && status?.status === 'running';

  return (
    <footer className="flex h-6 items-center gap-0 border-t border-border bg-panel px-2 text-[11px] text-muted">
      <span className="flex items-center gap-1.5 pr-3">
        <span aria-hidden="true" className={running ? 'text-good' : 'text-bad'}>
          ●
        </span>
        {unreachable ? 'Unreachable' : status === null ? 'Connecting…' : running ? 'Running' : status.status}
      </span>
      <span aria-hidden="true" className="h-3.5 border-l border-border" />
      <span className="px-3 tabular-nums">
        Uptime: {status ? formatUptime(status.uptimeMs) : '—'}
      </span>
      <span aria-hidden="true" className="h-3.5 border-l border-border" />
      <span className="px-3 tabular-nums">
        Channels: {status?.counts.channels ?? 0} | Devices: {status?.counts.devices ?? 0} | Tags:{' '}
        {status?.counts.tags ?? 0}
      </span>
      <span aria-hidden="true" className="h-3.5 border-l border-border" />
      <span className="flex items-center gap-1.5 px-3">
        <span aria-hidden="true" className={connected ? 'text-good' : 'text-muted'}>
          ●
        </span>
        {connected ? 'Live values' : 'Live values: connecting…'}
      </span>
      <span className="ml-auto flex items-center opacity-50">
        <span className="px-3 font-mono">Ctrl+K</span>
        <span aria-hidden="true" className="h-3.5 border-l border-border" />
        <span translate="no" className="px-3 font-mono">
          OPC UA: —
        </span>
        <span aria-hidden="true" className="h-3.5 border-l border-border" />
        <span className="px-3 tabular-nums">Clients: —</span>
      </span>
    </footer>
  );
}
