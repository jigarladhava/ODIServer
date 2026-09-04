import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { formatRelativeTime, formatTimestamp } from '../lib/format';
import { useServerEvents } from '../lib/events';
import { useToasts } from '../lib/toast';
import type { EventSeverity, ServerEvent } from '../lib/types';
import { DataGrid } from './DataGrid';

const severityStyles: Record<EventSeverity, string> = {
  info: 'border-border bg-panel text-muted',
  warning: 'border-uncertain bg-uncertain-bg text-uncertain',
  error: 'border-bad bg-bad-bg text-bad',
};

const severityLabels: Record<EventSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
};

function SeverityBadge({ severity }: { severity: EventSeverity }) {
  return (
    <span
      className={`inline-block rounded-sm border px-1.5 py-px text-[11px] font-medium leading-4 ${severityStyles[severity]}`}
    >
      {severityLabels[severity]}
    </span>
  );
}

function copyEvent(event: ServerEvent): string {
  return `${formatTimestamp(event.timestamp)} [${event.severity.toUpperCase()}] ${event.source}: ${event.message}`;
}

function CopyButton({ event }: { event: ServerEvent }) {
  const { push } = useToasts();
  return (
    <button
      type="button"
      title="Copy event to clipboard (for support tickets)"
      aria-label="Copy event to clipboard"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard
          .writeText(copyEvent(event))
          .then(() => push({ tone: 'info', message: 'Event copied to clipboard.' }))
          .catch(() => push({ tone: 'error', message: 'Copy failed — clipboard unavailable.' }));
      }}
      className="rounded-sm border border-border bg-inset px-1.5 py-px text-[10px] text-muted hover:bg-hover hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
    >
      Copy
    </button>
  );
}

const focusRing =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

const SEVERITIES: EventSeverity[] = ['info', 'warning', 'error'];

/**
 * Live server event log grid (newest first). Backed by /api/events with
 * streamed updates over /ws. Severity/source filters, pause, and copy are
 * view-local; the underlying stream keeps running while paused.
 */
export function EventLogView() {
  const { events } = useServerEvents();
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<ServerEvent[] | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Set<EventSeverity>>(new Set());
  const [sourceFilter, setSourceFilter] = useState('');
  // Tick so relative timestamps ("2m ago") age while the log is on screen.
  const [, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow((n) => n + 1), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) set.add(e.source);
    return [...set].sort();
  }, [events]);

  const shown = frozen ?? events;
  const rows = useMemo(() => {
    const filtered = shown.filter(
      (e) =>
        (severityFilter.size === 0 || severityFilter.has(e.severity)) &&
        (sourceFilter === '' || e.source === sourceFilter),
    );
    return filtered.reverse();
  }, [shown, severityFilter, sourceFilter]);

  const columns = useMemo<ColumnDef<ServerEvent, any>[]>(
    () => [
      {
        accessorKey: 'timestamp',
        header: 'Time',
        enableColumnFilter: false,
        cell: (c) => {
          const ts = c.getValue<number>();
          return (
            <span title={formatTimestamp(ts)} className="font-mono tabular-nums">
              {formatRelativeTime(ts)}
            </span>
          );
        },
      },
      {
        accessorKey: 'severity',
        header: 'Severity',
        cell: (c) => <SeverityBadge severity={c.getValue<EventSeverity>()} />,
      },
      {
        accessorKey: 'source',
        header: 'Source',
        cell: (c) => <span className="font-mono">{c.getValue<string>()}</span>,
      },
      {
        accessorKey: 'message',
        header: 'Message',
        enableSorting: false,
        cell: (c) => <span title={c.getValue<string>()}>{c.getValue<string>()}</span>,
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ row }) => <CopyButton event={row.original} />,
      },
    ],
    [],
  );

  const togglePause = () => {
    if (paused) {
      setFrozen(null);
      setPaused(false);
    } else {
      setFrozen(events);
      setPaused(true);
    }
  };

  const toggleSeverity = (severity: EventSeverity) => {
    setSeverityFilter((prev) => {
      const next = new Set(prev);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-panel px-2">
        {SEVERITIES.map((severity) => {
          const active = severityFilter.has(severity);
          return (
            <button
              key={severity}
              type="button"
              aria-pressed={active}
              onClick={() => toggleSeverity(severity)}
              className={`rounded-sm border px-2 py-0.5 text-[11px] font-medium ${
                active ? severityStyles[severity] : 'border-border bg-inset text-muted'
              } hover:bg-hover ${focusRing}`}
            >
              {severityLabels[severity]}
            </button>
          );
        })}
        <select
          aria-label="Filter by source"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className={`h-6 rounded-sm border border-border bg-inset px-1 text-[11px] text-fg ${focusRing}`}
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={togglePause}
          aria-pressed={paused}
          title={paused ? 'Resume the live event stream' : 'Pause the stream (new events keep buffering)'}
          className={`ml-auto flex h-6 items-center gap-1 rounded-sm border border-border bg-inset px-2 text-[11px] text-fg hover:bg-hover ${focusRing}`}
        >
          <span aria-hidden="true" className={paused ? 'text-muted' : 'text-good'}>
            {paused ? '❚❚' : '●'}
          </span>
          {paused ? 'Paused' : 'Live'}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <DataGrid
          ariaLabel="Server events"
          data={rows}
          columns={columns}
          getRowId={(e) => String(e.id)}
          emptyMessage="No events recorded yet. Events appear here when devices connect, fail, or the configuration changes."
        />
      </div>
    </div>
  );
}
