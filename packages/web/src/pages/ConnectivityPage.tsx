import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { formatRelativeTime, formatTimestamp, formatValue } from '../lib/format';
import { useDirtyGuard } from '../lib/dirty';
import { useTagValues, type Trend } from '../lib/live-values';
import { useProject } from '../lib/project';
import type { Channel, DataType, Device, Driver, EntityKind, Tag } from '../lib/types';
import { DATA_TYPE_LABELS } from '../lib/labels';
import { BreadcrumbBar } from '../components/BreadcrumbBar';
import { DataGrid } from '../components/DataGrid';
import { EntityInspector } from '../components/EntityInspector';
import { EventLogView } from '../components/EventLogView';
import { PropertyInspector, type PropertyEntry } from '../components/PropertyInspector';
import { QualityBadge } from '../components/QualityBadge';
import { Tabs } from '../components/Tabs';
import { Tree, type NodeHealth, type TreeNode } from '../components/Tree';

type Selection =
  | { kind: 'connectivity' }
  | { kind: 'channel'; id: string }
  | { kind: 'device'; id: string }
  | { kind: 'eventlog' };

function parseNodeId(id: string | null): Selection {
  if (id === 'eventlog') return { kind: 'eventlog' };
  if (id?.startsWith('channel:')) return { kind: 'channel', id: id.slice(8) };
  if (id?.startsWith('device:')) return { kind: 'device', id: id.slice(7) };
  return { kind: 'connectivity' };
}

interface ChannelRow extends Channel {
  deviceCount: number;
}

interface DeviceRow extends Device {
  address: string;
  tagCount: number;
}

function deviceAddress(device: Device): string {
  const s = device.settings as { host?: string; port?: number; unitId?: number };
  if (s.host) return `${s.host}:${s.port ?? 502}`;
  if (s.unitId !== undefined) return `unit ${s.unitId}`;
  return '—';
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-block rounded-sm border px-1.5 py-px text-[11px] font-medium leading-4 ${
        enabled ? 'border-good bg-good-bg text-good' : 'border-border bg-panel text-muted'
      }`}
    >
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  );
}

/** Live cells — read the WS-fed value map straight from context. */
function TrendArrow({ trend }: { trend: Trend | undefined }) {
  if (!trend || trend === 'flat') return null;
  return (
    <span
      aria-hidden="true"
      title={trend === 'up' ? 'Value rising' : 'Value falling'}
      className={`text-[10px] leading-none ${trend === 'up' ? 'text-good' : 'text-bad'}`}
    >
      {trend === 'up' ? '▲' : '▼'}
    </span>
  );
}

function LiveValueCell({ tagId }: { tagId: string }) {
  const { values, trends } = useTagValues();
  const v = values[tagId];
  if (!v) return <span className="font-mono tabular-nums">—</span>;
  if (v.value === null && v.error) {
    return (
      <span title={v.error} className="block truncate font-mono text-muted">
        {v.error}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 font-mono tabular-nums">
      <TrendArrow trend={trends[tagId]} />
      {formatValue(v.value)}
    </span>
  );
}

function LiveQualityCell({ tagId }: { tagId: string }) {
  const { values } = useTagValues();
  const v = values[tagId];
  if (!v) return <span className="text-muted">—</span>;
  return (
    <span title={v.error} className="inline-block">
      <QualityBadge quality={v.quality} />
    </span>
  );
}

function LiveTimestampCell({ tagId }: { tagId: string }) {
  const { values } = useTagValues();
  const v = values[tagId];
  return (
    <span
      title={v ? formatTimestamp(v.timestamp) : undefined}
      className="font-mono tabular-nums"
    >
      {v ? formatRelativeTime(v.timestamp) : '—'}
    </span>
  );
}

const channelColumns: ColumnDef<ChannelRow, any>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: (c) => <span className="font-mono">{c.getValue<string>()}</span>,
  },
  { accessorKey: 'driver', header: 'Driver' },
  {
    accessorKey: 'enabled',
    header: 'Enabled',
    enableColumnFilter: false,
    cell: (c) => <EnabledBadge enabled={c.getValue<boolean>()} />,
  },
  {
    accessorKey: 'deviceCount',
    header: 'Devices',
    enableColumnFilter: false,
    cell: (c) => <span className="tabular-nums">{c.getValue<number>()}</span>,
  },
];

const deviceColumns: ColumnDef<DeviceRow, any>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: (c) => <span className="font-mono">{c.getValue<string>()}</span>,
  },
  {
    accessorKey: 'address',
    header: 'Address',
    cell: (c) => <span className="font-mono">{c.getValue<string>()}</span>,
  },
  {
    accessorKey: 'enabled',
    header: 'Enabled',
    enableColumnFilter: false,
    cell: (c) => <EnabledBadge enabled={c.getValue<boolean>()} />,
  },
  {
    accessorKey: 'tagCount',
    header: 'Tags',
    enableColumnFilter: false,
    cell: (c) => <span className="tabular-nums">{c.getValue<number>()}</span>,
  },
];

const tagColumns: ColumnDef<Tag, any>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: (c) => <span className="font-mono">{c.getValue<string>()}</span>,
  },
  {
    accessorKey: 'address',
    header: 'Address',
    cell: (c) => <span className="font-mono">{c.getValue<string>()}</span>,
  },
  {
    accessorKey: 'dataType',
    header: 'Data Type',
    cell: (c) => {
      const raw = c.getValue<DataType>();
      return <span title={raw}>{DATA_TYPE_LABELS[raw]}</span>;
    },
  },
  {
    accessorKey: 'scanRateMs',
    header: 'Scan Rate',
    enableColumnFilter: false,
    cell: (c) => (
      <span className="tabular-nums">{Number(c.getValue()).toLocaleString()} ms</span>
    ),
  },
  {
    id: 'value',
    header: 'Value',
    enableSorting: false,
    enableColumnFilter: false,
    cell: ({ row }) => <LiveValueCell tagId={row.original.id} />,
  },
  {
    id: 'quality',
    header: 'Quality',
    enableSorting: false,
    enableColumnFilter: false,
    cell: ({ row }) => <LiveQualityCell tagId={row.original.id} />,
  },
  {
    id: 'timestamp',
    header: 'Timestamp',
    enableSorting: false,
    enableColumnFilter: false,
    cell: ({ row }) => <LiveTimestampCell tagId={row.original.id} />,
  },
];

export function ConnectivityPage() {
  const { project, refresh } = useProject();
  const { values, paused, setPaused } = useTagValues();
  const { confirmDiscard } = useDirtyGuard();
  const [treeFilter, setTreeFilter] = useState('');
  const [activeTab, setActiveTab] = useState('items');
  const [searchParams, setSearchParams] = useSearchParams();
  const [bannerDismissed, setBannerDismissed] = useState<Set<string>>(new Set());

  const nodeId = searchParams.get('node') ?? 'connectivity';
  const rowId = searchParams.get('row');
  const selection = useMemo(() => parseNodeId(nodeId), [nodeId]);

  // Per-device connection health from live tag quality: any bad tag = bad,
  // any uncertain = uncertain, otherwise good. Devices with no live data yet
  // report no health (dot hidden). Single pass over tags.
  const deviceHealth = useMemo(() => {
    const health: Record<string, NodeHealth> = {};
    if (!project) return health;
    const rank: Record<NodeHealth, number> = { good: 0, uncertain: 1, bad: 2 };
    for (const tag of project.tags) {
      const q = values[tag.id]?.quality;
      if (!q) continue;
      const prev = health[tag.deviceId];
      if (!prev || rank[q] > rank[prev]) health[tag.deviceId] = q;
    }
    return health;
  }, [project, values]);

  // Devices where every live tag is bad — a likely comm failure worth a banner.
  const droppedDevices = useMemo(() => {
    if (!project) return [];
    return project.devices.filter(
      (d) => deviceHealth[d.id] === 'bad' && !bannerDismissed.has(d.id),
    );
  }, [project, deviceHealth, bannerDismissed]);

  // Keep tree node objects stable across value updates; health arrives via a
  // separate map so only the dot re-renders when a device's health changes.
  const tree = useMemo<TreeNode[]>(() => {
    if (!project) return [];
    return [
      {
        id: 'connectivity',
        label: 'Connectivity',
        type: 'connectivity',
        children: project.channels.map((channel) => ({
          id: `channel:${channel.id}`,
          label: channel.name,
          type: 'channel' as const,
          children: project.devices
            .filter((d) => d.channelId === channel.id)
            .map((device) => ({
              id: `device:${device.id}`,
              label: device.name,
              type: 'device' as const,
            })),
        })),
      },
      { id: 'eventlog', label: 'Event Log', type: 'eventlog' },
    ];
  }, [project]);

  const treeHealthRef = useRef<Record<string, NodeHealth>>({});
  const treeHealth = useMemo(() => {
    const next: Record<string, NodeHealth> = {};
    for (const [deviceId, health] of Object.entries(deviceHealth)) {
      next[`device:${deviceId}`] = health;
    }
    // Preserve identity when nothing changed so memoized tree rows don't re-render.
    const prev = treeHealthRef.current;
    const prevKeys = Object.keys(prev);
    const same =
      prevKeys.length === Object.keys(next).length &&
      prevKeys.every((k) => next[k] === prev[k]);
    if (same) return prev;
    treeHealthRef.current = next;
    return next;
  }, [deviceHealth]);

  const breadcrumb = useMemo(() => {
    if (!project) return ['Connectivity'];
    switch (selection.kind) {
      case 'connectivity':
        return ['Connectivity'];
      case 'eventlog':
        return ['Event Log'];
      case 'channel':
        return ['Connectivity', project.channels.find((c) => c.id === selection.id)?.name ?? '…'];
      case 'device': {
        const device = project.devices.find((d) => d.id === selection.id);
        const channel = project.channels.find((c) => c.id === device?.channelId);
        return ['Connectivity', channel?.name ?? '…', device?.name ?? '…'];
      }
    }
  }, [selection, project]);

  // Entity targeted by a grid row click (?row=), else the tree-selected entity.
  const inspectorTarget = useMemo((): {
    kind: EntityKind;
    entity: Channel | Device | Tag;
  } | null => {
    if (!project) return null;
    const find = (id: string) => {
      const channel = project.channels.find((c) => c.id === id);
      if (channel) return { kind: 'channel' as const, entity: channel };
      const device = project.devices.find((d) => d.id === id);
      if (device) return { kind: 'device' as const, entity: device };
      const tag = project.tags.find((t) => t.id === id);
      if (tag) return { kind: 'tag' as const, entity: tag };
      return null;
    };
    if (rowId) {
      const found = find(rowId);
      if (found) return found;
    }
    if (selection.kind === 'channel' || selection.kind === 'device') return find(selection.id);
    return null;
  }, [project, rowId, selection]);

  const inspectorParentDriver = (target: { kind: EntityKind; entity: Channel | Device | Tag } | null): Driver | undefined => {
    if (!project || !target) return undefined;
    if (target.kind === 'device') {
      const device = target.entity as Device;
      return project.channels.find((c) => c.id === device.channelId)?.driver;
    }
    if (target.kind === 'tag') {
      const tag = target.entity as Tag;
      const device = project.devices.find((d) => d.id === tag.deviceId);
      return device ? project.channels.find((c) => c.id === device.channelId)?.driver : undefined;
    }
    return undefined;
  };

  const rootEntries = useMemo<PropertyEntry[]>(() => {
    if (!project) return [];
    return [
      { name: 'Name', value: 'Connectivity' },
      { name: 'Channels', value: String(project.channels.length), mono: true },
      { name: 'Devices', value: String(project.devices.length), mono: true },
      { name: 'Tags', value: String(project.tags.length), mono: true },
    ];
  }, [project]);

  /** Read-only summary used in the bottom panel while the Properties tab owns the editor. */
  const summaryEntries = useMemo<PropertyEntry[]>(() => {
    if (!project || !inspectorTarget) return rootEntries;
    const { kind, entity } = inspectorTarget;
    if (kind === 'channel') {
      const channel = entity as Channel;
      return [
        { name: 'ID', value: channel.id, mono: true },
        { name: 'Name', value: channel.name, mono: true },
        { name: 'Driver', value: channel.driver, mono: true },
        { name: 'Enabled', value: channel.enabled ? 'Yes' : 'No' },
        {
          name: 'Devices',
          value: String(project.devices.filter((d) => d.channelId === channel.id).length),
          mono: true,
        },
      ];
    }
    if (kind === 'device') {
      const device = entity as Device;
      return [
        { name: 'ID', value: device.id, mono: true },
        { name: 'Name', value: device.name, mono: true },
        {
          name: 'Channel',
          value: project.channels.find((c) => c.id === device.channelId)?.name ?? '—',
        },
        { name: 'Address', value: deviceAddress(device), mono: true },
        { name: 'Enabled', value: device.enabled ? 'Yes' : 'No' },
        {
          name: 'Tags',
          value: String(project.tags.filter((t) => t.deviceId === device.id).length),
          mono: true,
        },
      ];
    }
    const tag = entity as Tag;
    return [
      { name: 'ID', value: tag.id, mono: true },
      { name: 'Name', value: tag.name, mono: true },
      { name: 'Address', value: tag.address, mono: true },
      { name: 'Data Type', value: DATA_TYPE_LABELS[tag.dataType] },
      { name: 'Scan Rate', value: `${tag.scanRateMs} ms`, mono: true },
      { name: 'Description', value: tag.description || '—' },
    ];
  }, [project, inspectorTarget, rootEntries]);

  const onTreeSelect = useCallback(
    (node: TreeNode) => {
      if (node.id !== nodeId && !confirmDiscard()) return;
      setSearchParams(node.id === 'connectivity' ? {} : { node: node.id });
    },
    [setSearchParams, confirmDiscard, nodeId],
  );

  const onRowSelect = (id: string) => {
    if (id !== rowId && !confirmDiscard()) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('row', id);
      return next;
    });
  };

  const itemsTabLabel =
    selection.kind === 'channel' ? 'Devices' : selection.kind === 'device' ? 'Tags' : 'Channels';

  const renderGrid = () => {
    if (!project) {
      return <p className="px-3 py-4 text-[12px] text-muted">Loading…</p>;
    }
    if (selection.kind === 'channel') {
      const rows: DeviceRow[] = project.devices
        .filter((d) => d.channelId === selection.id)
        .map((d) => ({
          ...d,
          address: deviceAddress(d),
          tagCount: project.tags.filter((t) => t.deviceId === d.id).length,
        }));
      return (
        <DataGrid
          ariaLabel="Devices"
          data={rows}
          columns={deviceColumns}
          getRowId={(d) => d.id}
          selectedRowId={rowId}
          onRowSelect={(d) => onRowSelect(d.id)}
          emptyMessage="No devices on this channel. Use New Device to add one."
        />
      );
    }
    if (selection.kind === 'device') {
      const rows = project.tags.filter((t) => t.deviceId === selection.id);
      return (
        <DataGrid
          ariaLabel="Tags"
          data={rows}
          columns={tagColumns}
          getRowId={(t) => t.id}
          selectedRowId={rowId}
          onRowSelect={(t) => onRowSelect(t.id)}
          emptyMessage="No tags on this device. Use New Tag to add one."
        />
      );
    }
    const rows: ChannelRow[] = project.channels.map((c) => ({
      ...c,
      deviceCount: project.devices.filter((d) => d.channelId === c.id).length,
    }));
    return (
      <DataGrid
        ariaLabel="Channels"
        data={rows}
        columns={channelColumns}
        getRowId={(c) => c.id}
        selectedRowId={rowId}
        onRowSelect={(c) => onRowSelect(c.id)}
        emptyMessage="No channels configured. Use New Channel to add one."
      />
    );
  };

  const inspector = inspectorTarget ? (
    <EntityInspector
      key={`${inspectorTarget.kind}:${inspectorTarget.entity.id}`}
      kind={inspectorTarget.kind}
      entity={inspectorTarget.entity}
      parentDriver={inspectorParentDriver(inspectorTarget)}
      onSaved={() => void refresh()}
    />
  ) : (
    <PropertyInspector title="Properties" entries={rootEntries} />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <BreadcrumbBar segments={breadcrumb} filter={treeFilter} onFilterChange={setTreeFilter} />
      {droppedDevices.length > 0 && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b border-bad/40 bg-bad-bg px-3 py-1 text-[12px] text-bad"
        >
          <span aria-hidden="true">⚠</span>
          <span className="min-w-0 flex-1 truncate">
            {droppedDevices.length === 1
              ? `Device "${droppedDevices[0].name}" is not communicating — all tags report bad quality.`
              : `${droppedDevices.length} devices are not communicating: ${droppedDevices
                  .map((d) => d.name)
                  .join(', ')}.`}
            {' '}See the Event Log for details.
          </span>
          <button
            type="button"
            onClick={() => onTreeSelect({ id: 'eventlog', label: 'Event Log', type: 'eventlog' })}
            className="shrink-0 rounded-sm border border-current px-2 py-0.5 text-[11px] font-medium hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            Open Event Log
          </button>
          <button
            type="button"
            aria-label="Dismiss device alert"
            onClick={() =>
              setBannerDismissed(new Set([...bannerDismissed, ...droppedDevices.map((d) => d.id)]))
            }
            className="shrink-0 px-1 hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-auto">
        <aside className="w-60 shrink-0 overflow-auto border-r border-border bg-panel">
          <Tree
            nodes={tree}
            selectedId={nodeId}
            onSelect={onTreeSelect}
            filter={treeFilter}
            health={treeHealth}
          />
        </aside>
        <section className="flex min-w-[480px] flex-1 flex-col bg-inset">
          {selection.kind === 'eventlog' ? (
            <div className="min-h-0 flex-1">
              <EventLogView />
            </div>
          ) : (
            <>
              <Tabs
                ariaLabel="Detail pane"
                tabs={[
                  { id: 'items', label: itemsTabLabel },
                  { id: 'properties', label: 'Properties' },
                  { id: 'log', label: 'Event Log' },
                ]}
                activeId={activeTab}
                onChange={setActiveTab}
                trailing={
                  selection.kind === 'device' ? (
                    <button
                      type="button"
                      onClick={() => setPaused(!paused)}
                      aria-pressed={paused}
                      title={
                        paused
                          ? 'Resume live value updates'
                          : 'Pause live value updates (the grid stops moving while you scroll)'
                      }
                      className="flex h-5 items-center gap-1 rounded-sm border border-border bg-inset px-2 text-[11px] text-fg hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                    >
                      <span aria-hidden="true" className={paused ? 'text-muted' : 'text-good'}>
                        {paused ? '❚❚' : '●'}
                      </span>
                      {paused ? 'Paused' : 'Live'}
                    </button>
                  ) : undefined
                }
              />
              <div className="min-h-0 flex-1">
                {activeTab === 'log' ? (
                  <EventLogView />
                ) : activeTab === 'properties' ? (
                  inspector
                ) : (
                  renderGrid()
                )}
              </div>
              <div className="h-60 shrink-0 border-t border-border">
                {activeTab === 'properties' ? (
                  <PropertyInspector
                    title={inspectorTarget ? `Selection — ${inspectorTarget.entity.name}` : 'Properties'}
                    entries={summaryEntries}
                  />
                ) : (
                  inspector
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
