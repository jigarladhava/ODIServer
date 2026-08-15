import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  createMqttAgent,
  deleteMqttAgent,
  getMqttAgents,
  getMqttAgentStatus,
  updateMqttAgent,
} from '../lib/api-client';
import { slugify, uniqueId } from '../lib/ids';
import type { MqttAgent, MqttAgentStatus } from '../lib/types';
import { DataGrid } from '../components/DataGrid';
import { Modal } from '../components/Modal';

const inputClass =
  'h-6 w-full max-w-72 rounded-sm border border-border bg-inset px-1.5 text-[12px] text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

const monoClass = `${inputClass} font-mono tabular-nums`;

const selectClass =
  'h-6 w-full max-w-72 rounded-sm border border-border bg-inset px-1 text-[12px] text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

const buttonClass =
  'h-6 rounded-sm border border-border bg-inset px-3 text-[12px] enabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-center border-b border-border text-[12px]">
      {htmlFor ? (
        <label
          htmlFor={htmlFor}
          className="h-full cursor-pointer border-r border-border px-2 py-1 text-muted"
        >
          {label}
        </label>
      ) : (
        <span className="border-r border-border px-2 py-1 text-muted">{label}</span>
      )}
      <div className="min-w-0 px-2 py-0.5">{children}</div>
    </div>
  );
}

function StateBadge({ status }: { status: MqttAgentStatus | undefined }) {
  const state = status?.state ?? 'connecting';
  const style =
    state === 'connected'
      ? 'border-good bg-good-bg text-good'
      : state === 'error'
        ? 'border-bad bg-bad-bg text-bad'
        : state === 'disabled'
          ? 'border-border bg-panel text-muted'
          : 'border-border bg-inset text-fg';
  return (
    <span
      title={status?.lastError}
      className={`inline-block rounded-sm border px-1.5 py-px text-[11px] font-medium leading-4 ${style}`}
    >
      {state}
    </span>
  );
}

const agentColumns: ColumnDef<MqttAgent, any>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: (c) => <span className="font-mono">{c.getValue<string>()}</span>,
  },
  {
    accessorKey: 'url',
    header: 'Broker URL',
    cell: (c) => <span className="font-mono">{c.getValue<string>()}</span>,
  },
  { accessorKey: 'mode', header: 'Mode' },
  {
    accessorKey: 'enabled',
    header: 'Enabled',
    enableColumnFilter: false,
    cell: (c) => (c.getValue<boolean>() ? 'Yes' : 'No'),
  },
];

// ---------------------------------------------------------------------------
// Agent editor
// ---------------------------------------------------------------------------

function AgentEditor({
  agent,
  status,
  onSaved,
}: {
  agent: MqttAgent;
  status: MqttAgentStatus | undefined;
  onSaved: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [enabled, setEnabled] = useState(agent.enabled);
  const [url, setUrl] = useState(agent.url);
  const [clientId, setClientId] = useState(agent.clientId);
  const [username, setUsername] = useState(agent.username ?? '');
  const [password, setPassword] = useState(agent.password ?? '');
  const [keepaliveSec, setKeepaliveSec] = useState(String(agent.keepaliveSec));
  const [clean, setClean] = useState(agent.clean);
  const [rejectUnauthorized, setRejectUnauthorized] = useState(agent.tls.rejectUnauthorized);
  const [caPath, setCaPath] = useState(agent.tls.caPath ?? '');
  const [certPath, setCertPath] = useState(agent.tls.certPath ?? '');
  const [keyPath, setKeyPath] = useState(agent.tls.keyPath ?? '');
  const [mode, setMode] = useState<MqttAgent['mode']>(agent.mode);
  const [intervalMs, setIntervalMs] = useState(String(agent.intervalMs));
  const [deadband, setDeadband] = useState(String(agent.deadband));
  const [qos, setQos] = useState(String(agent.qos));
  const [retain, setRetain] = useState(agent.retain);
  const [topicPattern, setTopicPattern] = useState(agent.topicPattern);
  const [payloadFormat, setPayloadFormat] = useState<MqttAgent['payloadFormat']>(agent.payloadFormat);
  const [payloadTemplate, setPayloadTemplate] = useState(agent.payloadTemplate);
  const [lwtEnabled, setLwtEnabled] = useState(agent.lwt.enabled);
  const [lwtTopic, setLwtTopic] = useState(agent.lwt.topic);
  const [lwtOnline, setLwtOnline] = useState(agent.lwt.onlinePayload);
  const [lwtOffline, setLwtOffline] = useState(agent.lwt.offlinePayload);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const save = async (finalUrl: string) => {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await updateMqttAgent(agent.id, {
        ...agent,
        name: name.trim(),
        enabled,
        url: finalUrl,
        clientId: clientId.trim(),
        username: username.trim() === '' ? undefined : username.trim(),
        password: password === '' ? undefined : password,
        keepaliveSec: Number(keepaliveSec),
        clean,
        tls: {
          rejectUnauthorized,
          caPath: caPath.trim() || undefined,
          certPath: certPath.trim() || undefined,
          keyPath: keyPath.trim() || undefined,
        },
        mode,
        intervalMs: Number(intervalMs),
        deadband: Number(deadband),
        qos: Number(qos) as 0 | 1 | 2,
        retain,
        topicPattern: topicPattern.trim(),
        payloadFormat,
        payloadTemplate,
        lwt: {
          enabled: lwtEnabled,
          topic: lwtTopic.trim(),
          onlinePayload: lwtOnline,
          offlinePayload: lwtOffline,
        },
      });
      setSaved(true);
      onSaved();
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedUrl = url.trim();
    if (trimmedUrl !== '' && !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedUrl)) {
      // No scheme — ask before assuming plain mqtt://.
      setPendingUrl(`mqtt://${trimmedUrl}`);
      return;
    }
    await save(trimmedUrl);
  };

  const onConfirmPendingUrl = async () => {
    const finalUrl = pendingUrl;
    setPendingUrl(null);
    if (finalUrl) {
      setUrl(finalUrl);
      await save(finalUrl);
    }
  };

  return (
    <section aria-label={`MQTT agent ${agent.name}`} className="flex h-full flex-col bg-panel">
      <h2 className="border-b border-border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        MQTT Agent — {agent.name}
      </h2>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <Row label="Status">
            <span className="flex items-center gap-2">
              <StateBadge status={status} />
              <span className="text-[11px] text-muted tabular-nums">
                {status ? `${status.publishedCount} published` : ''}
                {status?.lastPublishAt
                  ? ` · last ${new Date(status.lastPublishAt).toLocaleTimeString()}`
                  : ''}
              </span>
            </span>
          </Row>
          {status?.lastError && (
            <Row label="Last Error">
              <span translate="no" className="break-words font-mono text-[12px] text-bad">
                {status.lastError}
              </span>
            </Row>
          )}
          <Row label="ID">
            <span translate="no" className="font-mono text-muted">
              {agent.id}
            </span>
          </Row>
          <Row label="Name" htmlFor="mqtt-name">
            <input id="mqtt-name" type="text" autoComplete="off" spellCheck={false} value={name} onChange={(e) => setName(e.target.value)} className={monoClass} />
          </Row>
          <Row label="Enabled" htmlFor="mqtt-enabled">
            <input id="mqtt-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          </Row>
          <Row label="Broker URL" htmlFor="mqtt-url">
            <input id="mqtt-url" type="text" autoComplete="off" spellCheck={false} placeholder="mqtt://host:1883" value={url} onChange={(e) => setUrl(e.target.value)} className={monoClass} />
          </Row>
          <Row label="Client ID" htmlFor="mqtt-client-id">
            <input id="mqtt-client-id" type="text" autoComplete="off" spellCheck={false} placeholder="auto" value={clientId} onChange={(e) => setClientId(e.target.value)} className={monoClass} />
          </Row>
          <Row label="Username" htmlFor="mqtt-username">
            <input id="mqtt-username" type="text" autoComplete="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} className={monoClass} />
          </Row>
          <Row label="Password" htmlFor="mqtt-password">
            <input id="mqtt-password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={monoClass} />
          </Row>
          <Row label="Keepalive (s)" htmlFor="mqtt-keepalive">
            <input id="mqtt-keepalive" type="number" inputMode="numeric" min={0} autoComplete="off" value={keepaliveSec} onChange={(e) => setKeepaliveSec(e.target.value)} className={monoClass} />
          </Row>
          <Row label="Clean Session" htmlFor="mqtt-clean">
            <input id="mqtt-clean" type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          </Row>
          <Row label="Verify TLS Cert" htmlFor="mqtt-tls-verify">
            <input id="mqtt-tls-verify" type="checkbox" checked={rejectUnauthorized} onChange={(e) => setRejectUnauthorized(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          </Row>
          <Row label="CA / Cert / Key" htmlFor="mqtt-tls-ca">
            <span className="flex max-w-72 flex-col gap-1">
              <input id="mqtt-tls-ca" type="text" autoComplete="off" spellCheck={false} placeholder="ca.pem" value={caPath} onChange={(e) => setCaPath(e.target.value)} className={monoClass} />
              <input aria-label="Client certificate path" type="text" autoComplete="off" spellCheck={false} placeholder="client cert.pem" value={certPath} onChange={(e) => setCertPath(e.target.value)} className={monoClass} />
              <input aria-label="Client key path" type="text" autoComplete="off" spellCheck={false} placeholder="client key.pem" value={keyPath} onChange={(e) => setKeyPath(e.target.value)} className={monoClass} />
            </span>
          </Row>
          <Row label="Publish Mode" htmlFor="mqtt-mode">
            <select id="mqtt-mode" value={mode} onChange={(e) => setMode(e.target.value as MqttAgent['mode'])} className={selectClass}>
              <option value="on-change">On Change</option>
              <option value="interval">Interval</option>
            </select>
          </Row>
          {mode === 'interval' && (
            <Row label="Interval (ms)" htmlFor="mqtt-interval">
              <input id="mqtt-interval" type="number" inputMode="numeric" min={100} step={100} autoComplete="off" value={intervalMs} onChange={(e) => setIntervalMs(e.target.value)} className={monoClass} />
            </Row>
          )}
          <Row label="Deadband" htmlFor="mqtt-deadband">
            <input id="mqtt-deadband" type="number" inputMode="numeric" min={0} autoComplete="off" value={deadband} onChange={(e) => setDeadband(e.target.value)} className={monoClass} />
          </Row>
          <Row label="QoS" htmlFor="mqtt-qos">
            <select id="mqtt-qos" value={qos} onChange={(e) => setQos(e.target.value)} className={selectClass}>
              <option value="0">0 — At most once</option>
              <option value="1">1 — At least once</option>
              <option value="2">2 — Exactly once</option>
            </select>
          </Row>
          <Row label="Retain" htmlFor="mqtt-retain">
            <input id="mqtt-retain" type="checkbox" checked={retain} onChange={(e) => setRetain(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          </Row>
          <Row label="Topic Pattern" htmlFor="mqtt-topic">
            <span className="flex max-w-72 flex-col gap-0.5">
              <input id="mqtt-topic" type="text" autoComplete="off" spellCheck={false} value={topicPattern} onChange={(e) => setTopicPattern(e.target.value)} className={monoClass} />
              <span className="font-mono text-[10px] text-muted">
                {'{channel} {channelId} {device} {deviceId} {tag} {tagId} {dataType}'}
              </span>
            </span>
          </Row>
          <Row label="Payload Format" htmlFor="mqtt-payload-format">
            <select id="mqtt-payload-format" value={payloadFormat} onChange={(e) => setPayloadFormat(e.target.value as MqttAgent['payloadFormat'])} className={selectClass}>
              <option value="default">Default JSON</option>
              <option value="template">Custom Template</option>
            </select>
          </Row>
          {payloadFormat === 'template' && (
            <Row label="Payload Template" htmlFor="mqtt-payload-template">
              <span className="flex max-w-96 flex-col gap-0.5">
                <textarea
                  id="mqtt-payload-template"
                  rows={3}
                  spellCheck={false}
                  placeholder='{"tag":"{tag}","value":{value},"quality":"{quality}","ts":{timestamp}}'
                  value={payloadTemplate}
                  onChange={(e) => setPayloadTemplate(e.target.value)}
                  className="w-full rounded-sm border border-border bg-inset px-1.5 py-1 font-mono text-[12px] text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                />
                <span className="font-mono text-[10px] text-muted">
                  topic tokens + {'{value} {quality} {timestamp}'} — {'{value}'} keeps its JSON type
                </span>
              </span>
            </Row>
          )}
          <Row label="Birth/Will (LWT)" htmlFor="mqtt-lwt">
            <input id="mqtt-lwt" type="checkbox" checked={lwtEnabled} onChange={(e) => setLwtEnabled(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          </Row>
          {lwtEnabled && (
            <>
              <Row label="LWT Topic" htmlFor="mqtt-lwt-topic">
                <input id="mqtt-lwt-topic" type="text" autoComplete="off" spellCheck={false} placeholder="odiserver/status/agent" value={lwtTopic} onChange={(e) => setLwtTopic(e.target.value)} className={monoClass} />
              </Row>
              <Row label="Online Payload" htmlFor="mqtt-lwt-online">
                <input id="mqtt-lwt-online" type="text" autoComplete="off" value={lwtOnline} onChange={(e) => setLwtOnline(e.target.value)} className={monoClass} />
              </Row>
              <Row label="Offline Payload" htmlFor="mqtt-lwt-offline">
                <input id="mqtt-lwt-offline" type="text" autoComplete="off" value={lwtOffline} onChange={(e) => setLwtOffline(e.target.value)} className={monoClass} />
              </Row>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-2 py-1.5">
          <button
            type="submit"
            disabled={busy}
            className="h-6 rounded-sm border border-accent bg-accent px-3 text-[11px] font-medium text-accent-fg enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <span aria-live="polite" className="text-[11px] text-good">
            {saved ? 'Saved.' : ''}
          </span>
          {error && (
            <span role="alert" className="min-w-0 flex-1 truncate font-mono text-[11px] text-bad" title={error}>
              {error}
            </span>
          )}
        </div>
      </form>

      <Modal
        open={pendingUrl !== null}
        onClose={() => setPendingUrl(null)}
        title="Assume mqtt:// Protocol?"
        footer={
          <>
            <button type="button" onClick={() => setPendingUrl(null)} className={buttonClass}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirmPendingUrl()}
              className="h-6 rounded-sm border border-accent bg-accent px-3 text-[12px] font-medium text-accent-fg enabled:hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            >
              Save with mqtt://
            </button>
          </>
        }
      >
        <p className="text-[12px] text-fg">
          The broker URL has no protocol. It will be saved as{' '}
          <span className="font-mono">{pendingUrl}</span> (plain TCP, default port 1883). Use{' '}
          <span className="font-mono">mqtts://</span> instead if the broker requires TLS.
        </p>
      </Modal>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function MqttPage() {
  const [agents, setAgents] = useState<MqttAgent[]>([]);
  const [status, setStatus] = useState<Record<string, MqttAgentStatus>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MqttAgent | null>(null);
  const [actionError, setActionError] = useState('');

  const reloadAgents = useCallback(async () => {
    try {
      setAgents(await getMqttAgents());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reloadAgents();
  }, [reloadAgents]);

  // Live status polling.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getMqttAgentStatus();
        if (!cancelled) setStatus(next);
      } catch {
        // status is best-effort; leave the previous map in place
      }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const selected = agents.find((a) => a.id === selectedId);

  const onNewAgent = async () => {
    try {
      const id = uniqueId(slugify('agent'), agents.map((a) => a.id));
      const created = await createMqttAgent({
        id,
        name: `Agent ${agents.length + 1}`,
        url: 'mqtt://localhost:1883',
      });
      await reloadAgents();
      setSelectedId(created.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDeleteConfirmed = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMqttAgent(deleteTarget.id);
      setDeleteTarget(null);
      if (selectedId === deleteTarget.id) setSelectedId(null);
      await reloadAgents();
    } catch (err) {
      setDeleteTarget(null);
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border bg-panel px-2 py-1">
        <button type="button" onClick={onNewAgent} className={buttonClass}>
          New Agent
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={() => selected && setDeleteTarget(selected)}
          className={buttonClass}
        >
          Delete Agent
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-h-0 border-r border-border">
          <DataGrid
            data={agents}
            columns={agentColumns}
            getRowId={(a) => a.id}
            selectedRowId={selectedId}
            onRowSelect={(a) => setSelectedId(a.id)}
            emptyMessage="No MQTT agents. Use New Agent to create one."
            ariaLabel="MQTT agents"
          />
        </div>
        <div className="min-h-0">
          {selected ? (
            <AgentEditor
              key={selected.id}
              agent={selected}
              status={status[selected.id]}
              onSaved={() => void reloadAgents()}
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-panel text-[12px] text-muted">
              Select an agent to edit its settings.
            </div>
          )}
        </div>
      </div>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete MQTT Agent"
        footer={
          <>
            <button type="button" onClick={() => setDeleteTarget(null)} className={buttonClass}>
              Cancel
            </button>
            <button
              type="button"
              onClick={onDeleteConfirmed}
              className="h-6 rounded-sm border border-bad bg-bad px-3 text-[12px] font-medium text-white hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            >
              Delete
            </button>
          </>
        }
      >
        <p className="text-[12px] text-fg">
          Delete agent &quot;{deleteTarget?.name}&quot;? Publishing to {deleteTarget?.url} stops
          immediately. Per-tag overrides for this agent are left in place but become inactive.
        </p>
      </Modal>

      <Modal
        open={actionError !== ''}
        onClose={() => setActionError('')}
        title="Operation Failed"
        footer={
          <button type="button" onClick={() => setActionError('')} className={buttonClass}>
            Close
          </button>
        }
      >
        <p role="alert" className="whitespace-pre-wrap font-mono text-[11px] text-bad">
          {actionError}
        </p>
      </Modal>
    </div>
  );
}
