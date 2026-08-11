import { useEffect, useState } from 'react';
import { getStatus } from '../lib/api-client';
import { formatUptime } from '../lib/format';
import { useTagValues } from '../lib/live-values';
import { useProject } from '../lib/project';
import type { ServerStatus } from '../lib/types';
import { QualityBadge } from '../components/QualityBadge';

function Card({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-sm border border-border bg-panel px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div
        translate={mono ? 'no' : undefined}
        className={`mt-0.5 truncate text-[15px] font-medium ${mono ? 'font-mono tabular-nums' : ''}`}
      >
        {value}
      </div>
    </div>
  );
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

function deviceAddress(settings: Record<string, unknown>): string {
  const s = settings as { host?: string; port?: number; unitId?: number };
  if (s.host) return `${s.host}:${s.port ?? 502}`;
  if (s.unitId !== undefined) return `unit ${s.unitId}`;
  return '—';
}

export function DiagnosticsPage() {
  const { project } = useProject();
  const { values, connected } = useTagValues();
  const [status, setStatus] = useState<ServerStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getStatus()
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {
          // status endpoint unreachable — leave the last known state on screen
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const qualityCounts = { good: 0, uncertain: 0, bad: 0 };
  for (const v of Object.values(values)) qualityCounts[v.quality] += 1;

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-canvas p-3">
      <h1 className="mb-2 text-[13px] font-semibold">Diagnostics</h1>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card label="Server Status" value={status ? status.status : '…'} />
        <Card label="Uptime" value={status ? formatUptime(status.uptimeMs) : '…'} mono />
        <Card label="Channels" value={String(status?.counts.channels ?? project?.channels.length ?? 0)} mono />
        <Card label="Devices" value={String(status?.counts.devices ?? project?.devices.length ?? 0)} mono />
        <Card label="Tags" value={String(status?.counts.tags ?? project?.tags.length ?? 0)} mono />
        <Card label="Live Values" value={connected ? 'Connected' : 'Disconnected'} />
      </div>

      {project && (
        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
          <section aria-label="Channels" className="rounded-sm border border-border bg-inset">
            <h2 className="border-b border-border bg-panel px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Channels
            </h2>
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-panel text-left font-medium">
                  <th scope="col" className="border-b border-r border-border px-2 py-1">Name</th>
                  <th scope="col" className="border-b border-r border-border px-2 py-1">Driver</th>
                  <th scope="col" className="w-20 border-b border-r border-border px-2 py-1">Devices</th>
                  <th scope="col" className="w-24 border-b border-border px-2 py-1">State</th>
                </tr>
              </thead>
              <tbody>
                {project.channels.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="border-b border-border px-2 py-3 text-center text-muted">
                      No channels configured.
                    </td>
                  </tr>
                ) : (
                  project.channels.map((c) => (
                    <tr key={c.id} className="hover:bg-hover">
                      <td translate="no" className="border-b border-border px-2 py-1 font-mono">{c.name}</td>
                      <td translate="no" className="border-b border-border px-2 py-1 font-mono">{c.driver}</td>
                      <td className="border-b border-border px-2 py-1 tabular-nums">
                        {project.devices.filter((d) => d.channelId === c.id).length}
                      </td>
                      <td className="border-b border-border px-2 py-1">
                        <EnabledBadge enabled={c.enabled} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section aria-label="Devices" className="rounded-sm border border-border bg-inset">
            <h2 className="border-b border-border bg-panel px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Devices
            </h2>
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-panel text-left font-medium">
                  <th scope="col" className="border-b border-r border-border px-2 py-1">Name</th>
                  <th scope="col" className="border-b border-r border-border px-2 py-1">Channel</th>
                  <th scope="col" className="border-b border-r border-border px-2 py-1">Address</th>
                  <th scope="col" className="w-24 border-b border-border px-2 py-1">State</th>
                </tr>
              </thead>
              <tbody>
                {project.devices.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="border-b border-border px-2 py-3 text-center text-muted">
                      No devices configured.
                    </td>
                  </tr>
                ) : (
                  project.devices.map((d) => (
                    <tr key={d.id} className="hover:bg-hover">
                      <td translate="no" className="border-b border-border px-2 py-1 font-mono">{d.name}</td>
                      <td translate="no" className="border-b border-border px-2 py-1">
                        {project.channels.find((c) => c.id === d.channelId)?.name ?? '—'}
                      </td>
                      <td translate="no" className="border-b border-border px-2 py-1 font-mono">
                        {deviceAddress(d.settings)}
                      </td>
                      <td className="border-b border-border px-2 py-1">
                        <EnabledBadge enabled={d.enabled} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        </div>
      )}

      <section aria-label="Tag quality summary" className="mt-3 rounded-sm border border-border bg-inset">
        <h2 className="border-b border-border bg-panel px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Tag Quality (live)
        </h2>
        <div className="flex flex-wrap items-center gap-4 px-3 py-2 text-[12px]">
          <span className="flex items-center gap-1.5">
            <QualityBadge quality="good" />
            <span className="tabular-nums">{qualityCounts.good}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <QualityBadge quality="bad" />
            <span className="tabular-nums">{qualityCounts.bad}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <QualityBadge quality="uncertain" />
            <span className="tabular-nums">{qualityCounts.uncertain}</span>
          </span>
        </div>
      </section>
    </div>
  );
}
