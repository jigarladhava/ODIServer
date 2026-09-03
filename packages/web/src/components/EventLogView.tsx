import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { formatTimestamp } from '../lib/format';
import { useServerEvents } from '../lib/events';
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

const eventColumns: ColumnDef<ServerEvent, any>[] = [
  {
    accessorKey: 'timestamp',
    header: 'Timestamp',
    enableColumnFilter: false,
    cell: (c) => (
      <span className="font-mono tabular-nums">{formatTimestamp(c.getValue<number>())}</span>
    ),
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
];

/**
 * Live server event log grid (newest first). Backed by /api/events with
 * streamed updates over /ws.
 */
export function EventLogView() {
  const { events } = useServerEvents();
  const rows = useMemo(() => [...events].reverse(), [events]);
  return (
    <DataGrid
      ariaLabel="Server events"
      data={rows}
      columns={eventColumns}
      getRowId={(e) => String(e.id)}
      emptyMessage="No events recorded yet."
    />
  );
}
