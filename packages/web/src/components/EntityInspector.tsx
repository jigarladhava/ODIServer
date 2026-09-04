import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { getMqttAgents, updateEntity } from '../lib/api-client';
import { useDirtyGuard } from '../lib/dirty';
import { BYTE_ORDER_OPTIONS, DATA_TYPE_LABELS, DATA_TYPE_OPTIONS, isRegisterDataType } from '../lib/labels';
import { useTagValues } from '../lib/live-values';
import type { ByteOrder, Channel, DataType, Device, Driver, EntityKind, MqttAgent, MqttTagOverride, Tag, TagAccess } from '../lib/types';
import { formatValue } from '../lib/format';
import { WriteValueDialog } from './WriteValueDialog';

interface EntityInspectorProps {
  kind: EntityKind;
  entity: Channel | Device | Tag;
  /** Driver of the device's parent channel — decides which settings fields show. */
  parentDriver?: Driver;
  onSaved: () => void;
}

const inputClass =
  'h-6 w-full max-w-72 rounded-sm border border-border bg-inset px-1.5 text-[12px] text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

const monoClass = `${inputClass} font-mono tabular-nums`;

const selectClass =
  'h-6 w-full max-w-72 rounded-sm border border-border bg-inset px-1 text-[12px] text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

const DRIVERS: { value: Driver; label: string }[] = [
  { value: 'modbus-tcp', label: 'Modbus TCP/IP Ethernet' },
  { value: 'modbus-rtu', label: 'Modbus RTU Serial' },
  { value: 'opcua-client', label: 'OPC UA Client' },
];

const DATA_TYPES: DataType[] = DATA_TYPE_OPTIONS;

const OPCUA_SECURITY_POLICIES = [
  'None',
  'Basic128Rsa15',
  'Basic256',
  'Basic256Sha256',
  'Aes128_Sha256_RsaOaep',
  'Aes256_Sha256_RsaPss',
];

const OPCUA_SECURITY_MODES = ['None', 'Sign', 'SignAndEncrypt'];

const OPCUA_AUTH_TYPES: { value: string; label: string }[] = [
  { value: 'anonymous', label: 'Anonymous' },
  { value: 'username', label: 'Username & Password' },
  { value: 'certificate', label: 'Certificate' },
];

const OPCUA_UPDATE_MODES: { value: string; label: string }[] = [
  { value: 'subscribe', label: 'Subscribe (on data change)' },
  { value: 'poll', label: 'Poll (batched read)' },
];

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
    <div className="grid grid-cols-[140px_1fr] items-center border-b border-border text-[12px]">
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

function IdRow({ id }: { id: string }) {
  return (
    <Row label="ID">
      <span translate="no" className="font-mono text-muted">
        {id}
      </span>
    </Row>
  );
}

function EditorShell({
  title,
  onSubmit,
  busy,
  error,
  saved,
  dirty,
  children,
}: {
  title: string;
  onSubmit: (e: FormEvent) => void;
  busy: boolean;
  error: string;
  saved: boolean;
  dirty?: boolean;
  children: ReactNode;
}) {
  const { setDirty } = useDirtyGuard();
  useEffect(() => {
    setDirty(dirty ?? false);
    return () => setDirty(false);
  }, [dirty, setDirty]);

  return (
    <section aria-label={title} className="flex h-full flex-col bg-panel">
      <h2 className="flex items-center gap-2 border-b border-border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {title}
        {dirty && (
          <span className="rounded-sm border border-uncertain bg-uncertain-bg px-1.5 py-px font-medium normal-case tracking-normal text-uncertain">
            Unsaved changes
          </span>
        )}
      </h2>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
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
    </section>
  );
}

/** Shared submit plumbing: run the PUT, surface the server error, flash "Saved.". */
function useSave(onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const save = async (body: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await body();
      setSaved(true);
      onSaved();
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, saved, save };
}

/**
 * Compare the editor's current config against its first-render snapshot (not
 * the server entity — normalization like `mqtt: {}` vs an absent key would
 * otherwise report phantom dirtiness).
 */
function useInitialJson(currentJson: string): boolean {
  const initialRef = useRef<string | null>(null);
  if (initialRef.current === null) initialRef.current = currentJson;
  return currentJson !== initialRef.current;
}

function ChannelEditor({ entity, onSaved }: { entity: Channel; onSaved: () => void }) {
  const settings = entity.settings as {
    endpointUrl?: string;
    securityPolicy?: string;
    securityMode?: string;
    authType?: string;
    username?: string;
    password?: string;
    userCertificateFile?: string;
    userPrivateKeyFile?: string;
    clientCertificateFile?: string;
    clientPrivateKeyFile?: string;
    updateMode?: string;
    keepSessionAlive?: boolean;
    applicationName?: string;
    publishIntervalMs?: number;
  };
  const [name, setName] = useState(entity.name);
  const [driver, setDriver] = useState<Driver>(entity.driver);
  const [enabled, setEnabled] = useState(entity.enabled);
  const [endpointUrl, setEndpointUrl] = useState(settings.endpointUrl ?? '');
  const [securityPolicy, setSecurityPolicy] = useState(settings.securityPolicy ?? 'None');
  const [securityMode, setSecurityMode] = useState(settings.securityMode ?? 'None');
  const [authType, setAuthType] = useState(settings.authType ?? 'anonymous');
  const [username, setUsername] = useState(settings.username ?? '');
  const [password, setPassword] = useState(settings.password ?? '');
  const [userCertificateFile, setUserCertificateFile] = useState(settings.userCertificateFile ?? '');
  const [userPrivateKeyFile, setUserPrivateKeyFile] = useState(settings.userPrivateKeyFile ?? '');
  const [clientCertificateFile, setClientCertificateFile] = useState(settings.clientCertificateFile ?? '');
  const [clientPrivateKeyFile, setClientPrivateKeyFile] = useState(settings.clientPrivateKeyFile ?? '');
  const [updateMode, setUpdateMode] = useState(settings.updateMode ?? 'subscribe');
  const [keepSessionAlive, setKeepSessionAlive] = useState(settings.keepSessionAlive ?? true);
  const [applicationName, setApplicationName] = useState(settings.applicationName ?? '');
  const [publishIntervalMs, setPublishIntervalMs] = useState(String(settings.publishIntervalMs ?? 500));
  const { busy, error, saved, save } = useSave(onSaved);

  const isOpcUa = driver === 'opcua-client';

  const buildConfig = (): Channel => {
    const nextSettings: Record<string, unknown> = { ...entity.settings };
    if (isOpcUa) {
      nextSettings.endpointUrl = endpointUrl.trim();
      nextSettings.securityPolicy = securityPolicy;
      nextSettings.securityMode = securityMode;
      nextSettings.authType = authType;
      nextSettings.username = authType === 'username' ? username.trim() : undefined;
      nextSettings.password = authType === 'username' ? password : undefined;
      nextSettings.userCertificateFile = authType === 'certificate' ? userCertificateFile.trim() : undefined;
      nextSettings.userPrivateKeyFile = authType === 'certificate' ? userPrivateKeyFile.trim() : undefined;
      nextSettings.clientCertificateFile = securityMode !== 'None' ? clientCertificateFile.trim() : undefined;
      nextSettings.clientPrivateKeyFile = securityMode !== 'None' ? clientPrivateKeyFile.trim() : undefined;
      nextSettings.updateMode = updateMode;
      nextSettings.keepSessionAlive = keepSessionAlive;
      nextSettings.applicationName = applicationName.trim() || undefined;
      nextSettings.publishIntervalMs = Number(publishIntervalMs);
    }
    return { ...entity, name: name.trim(), driver, enabled, settings: nextSettings };
  };

  const dirty = useInitialJson(JSON.stringify(buildConfig()));

  return (
    <EditorShell
      title={`Channel — ${entity.name}`}
      busy={busy}
      error={error}
      saved={saved}
      dirty={dirty}
      onSubmit={(e) => {
        e.preventDefault();
        void save(() => updateEntity('channel', entity.id, buildConfig()));
      }}
    >
      <IdRow id={entity.id} />
      <Row label="Name" htmlFor="ed-channel-name">
        <input
          id="ed-channel-name"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={monoClass}
        />
      </Row>
      <Row label="Driver" htmlFor="ed-channel-driver">
        <select
          id="ed-channel-driver"
          value={driver}
          onChange={(e) => setDriver(e.target.value as Driver)}
          className={selectClass}
        >
          {DRIVERS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Enabled" htmlFor="ed-channel-enabled">
        <input
          id="ed-channel-enabled"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-3.5 w-3.5 accent-accent"
        />
      </Row>
      {isOpcUa && (
        <>
          <Row label="Endpoint URL" htmlFor="ed-channel-endpoint">
            <input
              id="ed-channel-endpoint"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="opc.tcp://host:49320"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              className={monoClass}
            />
          </Row>
          <Row label="Security Policy" htmlFor="ed-channel-secpol">
            <select
              id="ed-channel-secpol"
              value={securityPolicy}
              onChange={(e) => setSecurityPolicy(e.target.value)}
              className={selectClass}
            >
              {OPCUA_SECURITY_POLICIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Security Mode" htmlFor="ed-channel-secmode">
            <select
              id="ed-channel-secmode"
              value={securityMode}
              onChange={(e) => setSecurityMode(e.target.value)}
              className={selectClass}
            >
              {OPCUA_SECURITY_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Authentication" htmlFor="ed-channel-auth">
            <select
              id="ed-channel-auth"
              value={authType}
              onChange={(e) => setAuthType(e.target.value)}
              className={selectClass}
            >
              {OPCUA_AUTH_TYPES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </Row>
          {authType === 'username' && (
            <>
              <Row label="Username" htmlFor="ed-channel-username">
                <input
                  id="ed-channel-username"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={monoClass}
                />
              </Row>
              <Row label="Password" htmlFor="ed-channel-password">
                <input
                  id="ed-channel-password"
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={monoClass}
                />
              </Row>
            </>
          )}
          {authType === 'certificate' && (
            <>
              <Row label="Certificate File" htmlFor="ed-channel-usercert">
                <input
                  id="ed-channel-usercert"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="C:\certs\client.der"
                  value={userCertificateFile}
                  onChange={(e) => setUserCertificateFile(e.target.value)}
                  className={monoClass}
                />
              </Row>
              <Row label="Private Key File" htmlFor="ed-channel-userkey">
                <input
                  id="ed-channel-userkey"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="C:\certs\client.pem"
                  value={userPrivateKeyFile}
                  onChange={(e) => setUserPrivateKeyFile(e.target.value)}
                  className={monoClass}
                />
              </Row>
            </>
          )}
          {securityMode !== 'None' && (
            <>
              <Row label="Client Cert File" htmlFor="ed-channel-clientcert">
                <input
                  id="ed-channel-clientcert"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="empty = auto-generated self-signed"
                  value={clientCertificateFile}
                  onChange={(e) => setClientCertificateFile(e.target.value)}
                  className={monoClass}
                />
              </Row>
              <Row label="Client Key File" htmlFor="ed-channel-clientkey">
                <input
                  id="ed-channel-clientkey"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="empty = auto-generated self-signed"
                  value={clientPrivateKeyFile}
                  onChange={(e) => setClientPrivateKeyFile(e.target.value)}
                  className={monoClass}
                />
              </Row>
            </>
          )}
          <Row label="Update Mode" htmlFor="ed-channel-updatemode">
            <select
              id="ed-channel-updatemode"
              value={updateMode}
              onChange={(e) => setUpdateMode(e.target.value)}
              className={selectClass}
            >
              {OPCUA_UPDATE_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Publish Interval" htmlFor="ed-channel-publish">
            <input
              id="ed-channel-publish"
              type="text"
              inputMode="numeric"
              value={publishIntervalMs}
              onChange={(e) => setPublishIntervalMs(e.target.value)}
              className={monoClass}
            />
          </Row>
          <Row label="Keep-Alive" htmlFor="ed-channel-keepalive">
            <input
              id="ed-channel-keepalive"
              type="checkbox"
              checked={keepSessionAlive}
              onChange={(e) => setKeepSessionAlive(e.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
          </Row>
          <Row label="Application Name" htmlFor="ed-channel-appname">
            <input
              id="ed-channel-appname"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="default: ODIServer client"
              value={applicationName}
              onChange={(e) => setApplicationName(e.target.value)}
              className={monoClass}
            />
          </Row>
        </>
      )}
    </EditorShell>
  );
}

function DeviceEditor({
  entity,
  parentDriver,
  onSaved,
}: {
  entity: Device;
  parentDriver?: Driver;
  onSaved: () => void;
}) {
  const settings = entity.settings as {
    host?: string;
    port?: number;
    unitId?: number;
    blockReads?: boolean;
    maxBlockSize?: number;
    requestTimeoutMs?: number;
    interRequestDelayMs?: number;
    scanMode?: string;
    scanModeRateMs?: number;
  };
  const [name, setName] = useState(entity.name);
  const [enabled, setEnabled] = useState(entity.enabled);
  const [host, setHost] = useState(settings.host ?? '');
  const [port, setPort] = useState(String(settings.port ?? 502));
  const [unitId, setUnitId] = useState(String(settings.unitId ?? 1));
  const [blockReads, setBlockReads] = useState(settings.blockReads ?? true);
  const [maxBlockSize, setMaxBlockSize] = useState(String(settings.maxBlockSize ?? 120));
  const [requestTimeoutMs, setRequestTimeoutMs] = useState(String(settings.requestTimeoutMs ?? 1000));
  const [interRequestDelayMs, setInterRequestDelayMs] = useState(String(settings.interRequestDelayMs ?? 0));
  const [scanMode, setScanMode] = useState(settings.scanMode ?? 'respect-tag');
  const [scanModeRateMs, setScanModeRateMs] = useState(String(settings.scanModeRateMs ?? 1000));
  const { busy, error, saved, save } = useSave(onSaved);

  const isTcp = parentDriver === 'modbus-tcp';
  const isRtu = parentDriver === 'modbus-rtu';

  const buildConfig = (): Device => {
    const nextSettings: Record<string, unknown> = { ...entity.settings };
    if (isTcp) {
      nextSettings.host = host.trim();
      nextSettings.port = Number(port);
      nextSettings.unitId = Number(unitId);
    } else if (isRtu) {
      nextSettings.unitId = Number(unitId);
    }
    if (isTcp || isRtu) {
      nextSettings.blockReads = blockReads;
      nextSettings.maxBlockSize = Number(maxBlockSize);
      nextSettings.requestTimeoutMs = Number(requestTimeoutMs);
      nextSettings.interRequestDelayMs = Number(interRequestDelayMs);
      nextSettings.scanMode = scanMode;
      nextSettings.scanModeRateMs = Number(scanModeRateMs);
    }
    return { ...entity, name: name.trim(), enabled, settings: nextSettings };
  };

  const dirty = useInitialJson(JSON.stringify(buildConfig()));

  return (
    <EditorShell
      title={`Device — ${entity.name}`}
      busy={busy}
      error={error}
      saved={saved}
      dirty={dirty}
      onSubmit={(e) => {
        e.preventDefault();
        void save(() => updateEntity('device', entity.id, buildConfig()));
      }}
    >
      <IdRow id={entity.id} />
      <Row label="Name" htmlFor="ed-device-name">
        <input
          id="ed-device-name"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={monoClass}
        />
      </Row>
      {isTcp && (
        <>
          <Row label="Host" htmlFor="ed-device-host">
            <input
              id="ed-device-host"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className={monoClass}
            />
          </Row>
          <Row label="Port" htmlFor="ed-device-port">
            <input
              id="ed-device-port"
              type="number"
              inputMode="numeric"
              min={1}
              max={65535}
              autoComplete="off"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className={monoClass}
            />
          </Row>
        </>
      )}
      {(isTcp || isRtu) && (
        <>
          <Row label="Unit ID" htmlFor="ed-device-unit">
            <input
              id="ed-device-unit"
              type="number"
              inputMode="numeric"
              min={0}
              max={255}
              autoComplete="off"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className={monoClass}
            />
          </Row>
          <Row label="Block reads" htmlFor="ed-device-block-reads">
            <input
              id="ed-device-block-reads"
              type="checkbox"
              checked={blockReads}
              onChange={(e) => setBlockReads(e.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
          </Row>
          <Row label="Max block size" htmlFor="ed-device-max-block">
            <input
              id="ed-device-max-block"
              type="number"
              inputMode="numeric"
              min={1}
              max={120}
              autoComplete="off"
              disabled={!blockReads}
              value={maxBlockSize}
              onChange={(e) => setMaxBlockSize(e.target.value)}
              className={monoClass}
            />
          </Row>
          <Row label="Request timeout (ms)" htmlFor="ed-device-req-timeout">
            <input
              id="ed-device-req-timeout"
              type="number"
              inputMode="numeric"
              min={1}
              autoComplete="off"
              value={requestTimeoutMs}
              onChange={(e) => setRequestTimeoutMs(e.target.value)}
              className={monoClass}
            />
          </Row>
          <Row label="Inter-request delay (ms)" htmlFor="ed-device-req-delay">
            <input
              id="ed-device-req-delay"
              type="number"
              inputMode="numeric"
              min={0}
              autoComplete="off"
              value={interRequestDelayMs}
              onChange={(e) => setInterRequestDelayMs(e.target.value)}
              className={monoClass}
            />
          </Row>
          <Row label="Scan mode" htmlFor="ed-device-scan-mode">
            <select
              id="ed-device-scan-mode"
              value={scanMode}
              onChange={(e) => setScanMode(e.target.value)}
              className={selectClass}
            >
              <option value="respect-tag">Respect tag-specified scan rate</option>
              <option value="respect-device">Request all data at device rate</option>
            </select>
          </Row>
          {scanMode === 'respect-device' && (
            <Row label="Device scan rate (ms)" htmlFor="ed-device-scan-rate">
              <input
                id="ed-device-scan-rate"
                type="number"
                inputMode="numeric"
                min={50}
                step={50}
                autoComplete="off"
                value={scanModeRateMs}
                onChange={(e) => setScanModeRateMs(e.target.value)}
                className={monoClass}
              />
            </Row>
          )}
        </>
      )}
      <Row label="Enabled" htmlFor="ed-device-enabled">
        <input
          id="ed-device-enabled"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-3.5 w-3.5 accent-accent"
        />
      </Row>
    </EditorShell>
  );
}

/** Form state for one per-agent MQTT override. Empty string = inherit from the agent. */
interface MqttOverrideForm {
  custom: boolean;
  enabled: boolean;
  topic: string;
  mode: '' | 'on-change' | 'interval';
  intervalMs: string;
  deadband: string;
  qos: '' | '0' | '1' | '2';
  retain: '' | 'yes' | 'no';
  payloadFormat: '' | 'default' | 'template';
  payloadTemplate: string;
}

function defaultMqttForm(): MqttOverrideForm {
  return {
    custom: false,
    enabled: true,
    topic: '',
    mode: '',
    intervalMs: '',
    deadband: '',
    qos: '',
    retain: '',
    payloadFormat: '',
    payloadTemplate: '',
  };
}

function mqttFormFromOverride(override: MqttTagOverride): MqttOverrideForm {
  return {
    custom: true,
    enabled: override.enabled ?? true,
    topic: override.topic ?? '',
    mode: override.mode ?? '',
    intervalMs: override.intervalMs !== undefined ? String(override.intervalMs) : '',
    deadband: override.deadband !== undefined ? String(override.deadband) : '',
    qos: override.qos !== undefined ? (String(override.qos) as '0' | '1' | '2') : '',
    retain: override.retain === undefined ? '' : override.retain ? 'yes' : 'no',
    payloadFormat: override.payloadFormat ?? '',
    payloadTemplate: override.payloadTemplate ?? '',
  };
}

/** Build the override map to persist: custom agents get an entry, others inherit. */
function buildMqttOverrides(
  existing: Record<string, MqttTagOverride> | undefined,
  agents: MqttAgent[],
  forms: Record<string, MqttOverrideForm>,
): Record<string, MqttTagOverride> {
  // Keep entries for agents that no longer exist (they reactivate if the agent returns).
  const mqtt: Record<string, MqttTagOverride> = { ...(existing ?? {}) };
  for (const agent of agents) {
    const form = forms[agent.id];
    if (!form?.custom) {
      delete mqtt[agent.id];
      continue;
    }
    const override: MqttTagOverride = { enabled: form.enabled };
    if (form.topic.trim()) override.topic = form.topic.trim();
    if (form.mode) override.mode = form.mode;
    if (form.intervalMs.trim()) override.intervalMs = Number(form.intervalMs);
    if (form.deadband.trim()) override.deadband = Number(form.deadband);
    if (form.qos) override.qos = Number(form.qos) as 0 | 1 | 2;
    if (form.retain) override.retain = form.retain === 'yes';
    if (form.payloadFormat) override.payloadFormat = form.payloadFormat;
    if (form.payloadTemplate.trim()) override.payloadTemplate = form.payloadTemplate;
    mqtt[agent.id] = override;
  }
  return mqtt;
}

/** Per-agent override editor rows inside the tag inspector. */
function MqttAgentOverrideEditor({
  agent,
  form,
  onChange,
}: {
  agent: MqttAgent;
  form: MqttOverrideForm;
  onChange: (patch: Partial<MqttOverrideForm>) => void;
}) {
  return (
    <>
      <Row label={agent.name} htmlFor={`mqtt-custom-${agent.id}`}>
        <label className="flex items-center gap-1.5 text-[12px]">
          <input
            id={`mqtt-custom-${agent.id}`}
            type="checkbox"
            checked={form.custom}
            onChange={(e) => onChange({ custom: e.target.checked })}
            className="h-3.5 w-3.5 accent-accent"
          />
          <span className="text-muted">Custom settings (unchecked = use agent defaults)</span>
        </label>
      </Row>
      {form.custom && (
        <>
          <Row label="↳ Publish" htmlFor={`mqtt-enabled-${agent.id}`}>
            <input
              id={`mqtt-enabled-${agent.id}`}
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 accent-accent"
            />
          </Row>
          {form.enabled && (
            <>
              <Row label="↳ Topic" htmlFor={`mqtt-topic-${agent.id}`}>
                <input
                  id={`mqtt-topic-${agent.id}`}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={agent.topicPattern}
                  value={form.topic}
                  onChange={(e) => onChange({ topic: e.target.value })}
                  className={monoClass}
                />
              </Row>
              <Row label="↳ Mode" htmlFor={`mqtt-mode-${agent.id}`}>
                <select
                  id={`mqtt-mode-${agent.id}`}
                  value={form.mode}
                  onChange={(e) => onChange({ mode: e.target.value as MqttOverrideForm['mode'] })}
                  className={selectClass}
                >
                  <option value="">Inherit ({agent.mode})</option>
                  <option value="on-change">On Change</option>
                  <option value="interval">Interval</option>
                </select>
              </Row>
              <Row label="↳ Interval (ms)" htmlFor={`mqtt-interval-${agent.id}`}>
                <input
                  id={`mqtt-interval-${agent.id}`}
                  type="number"
                  inputMode="numeric"
                  min={100}
                  step={100}
                  autoComplete="off"
                  placeholder={String(agent.intervalMs)}
                  value={form.intervalMs}
                  onChange={(e) => onChange({ intervalMs: e.target.value })}
                  className={monoClass}
                />
              </Row>
              <Row label="↳ Deadband" htmlFor={`mqtt-deadband-${agent.id}`}>
                <input
                  id={`mqtt-deadband-${agent.id}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  autoComplete="off"
                  placeholder={String(agent.deadband)}
                  value={form.deadband}
                  onChange={(e) => onChange({ deadband: e.target.value })}
                  className={monoClass}
                />
              </Row>
              <Row label="↳ QoS" htmlFor={`mqtt-qos-${agent.id}`}>
                <select
                  id={`mqtt-qos-${agent.id}`}
                  value={form.qos}
                  onChange={(e) => onChange({ qos: e.target.value as MqttOverrideForm['qos'] })}
                  className={selectClass}
                >
                  <option value="">Inherit ({agent.qos})</option>
                  <option value="0">0</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                </select>
              </Row>
              <Row label="↳ Retain" htmlFor={`mqtt-retain-${agent.id}`}>
                <select
                  id={`mqtt-retain-${agent.id}`}
                  value={form.retain}
                  onChange={(e) => onChange({ retain: e.target.value as MqttOverrideForm['retain'] })}
                  className={selectClass}
                >
                  <option value="">Inherit ({agent.retain ? 'yes' : 'no'})</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Row>
              <Row label="↳ Payload" htmlFor={`mqtt-payload-${agent.id}`}>
                <select
                  id={`mqtt-payload-${agent.id}`}
                  value={form.payloadFormat}
                  onChange={(e) =>
                    onChange({ payloadFormat: e.target.value as MqttOverrideForm['payloadFormat'] })
                  }
                  className={selectClass}
                >
                  <option value="">Inherit ({agent.payloadFormat})</option>
                  <option value="default">Default JSON</option>
                  <option value="template">Custom Template</option>
                </select>
              </Row>
              {form.payloadFormat === 'template' && (
                <Row label="↳ Template" htmlFor={`mqtt-template-${agent.id}`}>
                  <textarea
                    id={`mqtt-template-${agent.id}`}
                    rows={2}
                    spellCheck={false}
                    placeholder='{"tag":"{tag}","value":{value}}'
                    value={form.payloadTemplate}
                    onChange={(e) => onChange({ payloadTemplate: e.target.value })}
                    className="w-full max-w-96 rounded-sm border border-border bg-inset px-1.5 py-1 font-mono text-[12px] text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                  />
                </Row>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

function TagEditor({ entity, parentDriver, onSaved }: { entity: Tag; parentDriver?: Driver; onSaved: () => void }) {
  const isOpcUa = parentDriver === 'opcua-client';
  const [name, setName] = useState(entity.name);
  const [address, setAddress] = useState(entity.address);
  const [dataType, setDataType] = useState<DataType>(entity.dataType);
  const [byteOrder, setByteOrder] = useState<ByteOrder>(entity.byteOrder ?? 'big-endian');
  const [access, setAccess] = useState<TagAccess>(entity.access ?? 'rw');
  const [scanRateMs, setScanRateMs] = useState(String(entity.scanRateMs));
  const [deadband, setDeadband] = useState(String(entity.deadband));
  const [scalingEnabled, setScalingEnabled] = useState(entity.scaling.enabled);
  const [scalingType, setScalingType] = useState<'linear' | 'square-root'>(entity.scaling.type ?? 'linear');
  const [rawMin, setRawMin] = useState(String(entity.scaling.rawMin));
  const [rawMax, setRawMax] = useState(String(entity.scaling.rawMax));
  const [engMin, setEngMin] = useState(String(entity.scaling.engMin));
  const [engMax, setEngMax] = useState(String(entity.scaling.engMax));
  const [clampLow, setClampLow] = useState(entity.scaling.clampLow ?? false);
  const [clampHigh, setClampHigh] = useState(entity.scaling.clampHigh ?? false);
  const [negate, setNegate] = useState(entity.scaling.negate ?? false);
  const [description, setDescription] = useState(entity.description);
  const { busy, error, saved, save } = useSave(onSaved);

  // Per-agent MQTT publish overrides for this tag.
  const [mqttAgents, setMqttAgents] = useState<MqttAgent[]>([]);
  const [mqttForms, setMqttForms] = useState<Record<string, MqttOverrideForm>>(() => {
    const out: Record<string, MqttOverrideForm> = {};
    for (const [agentId, override] of Object.entries(entity.mqtt ?? {})) {
      out[agentId] = mqttFormFromOverride(override);
    }
    return out;
  });
  useEffect(() => {
    getMqttAgents()
      .then(setMqttAgents)
      .catch(() => {
        // Agents section is hidden when the list cannot be loaded.
      });
  }, []);
  const patchMqttForm = (agentId: string, patch: Partial<MqttOverrideForm>) =>
    setMqttForms((prev) => ({ ...prev, [agentId]: { ...(prev[agentId] ?? defaultMqttForm()), ...patch } }));

  const [writeOpen, setWriteOpen] = useState(false);

  const { values } = useTagValues();
  const lastError = values[entity.id]?.error;
  const liveValue = values[entity.id];

  const buildConfig = (): Tag => ({
    ...entity,
    name: name.trim(),
    address: address.trim(),
    dataType,
    ...(isOpcUa ? {} : isRegisterDataType(dataType) ? { byteOrder } : {}),
    access,
    scanRateMs: Number(scanRateMs),
    deadband: Number(deadband),
    scaling: {
      enabled: scalingEnabled,
      type: scalingType,
      rawMin: Number(rawMin),
      rawMax: Number(rawMax),
      engMin: Number(engMin),
      engMax: Number(engMax),
      clampLow,
      clampHigh,
      negate,
    },
    mqtt: buildMqttOverrides(entity.mqtt, mqttAgents, mqttForms),
    description: description.trim(),
  });

  const dirty = useInitialJson(JSON.stringify(buildConfig()));

  return (
    <EditorShell
      title={`Tag — ${entity.name}`}
      busy={busy}
      error={error}
      saved={saved}
      dirty={dirty}
      onSubmit={(e) => {
        e.preventDefault();
        void save(() => updateEntity('tag', entity.id, buildConfig()));
      }}
    >
      <IdRow id={entity.id} />
      <Row label="Name" htmlFor="ed-tag-name">
        <input
          id="ed-tag-name"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={monoClass}
        />
      </Row>
      <Row label={isOpcUa ? 'Node ID' : 'Address'} htmlFor="ed-tag-address">
        <input
          id="ed-tag-address"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={isOpcUa ? 'ns=2;s=Demo.Static.Scalar.Double' : '40001'}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className={monoClass}
        />
      </Row>
      <Row label="Data Type" htmlFor="ed-tag-datatype">
        <select
          id="ed-tag-datatype"
          value={dataType}
          onChange={(e) => setDataType(e.target.value as DataType)}
          className={selectClass}
        >
          {DATA_TYPES.map((t) => (
            <option key={t} value={t}>
              {DATA_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Access" htmlFor="ed-tag-access">
        <select
          id="ed-tag-access"
          value={access}
          onChange={(e) => setAccess(e.target.value as TagAccess)}
          className={selectClass}
        >
          <option value="ro">Read Only</option>
          <option value="rw">Read/Write</option>
        </select>
      </Row>
      {!isOpcUa && isRegisterDataType(dataType) && (
        <Row label="Byte Order" htmlFor="ed-tag-byteorder">
          <select
            id="ed-tag-byteorder"
            value={byteOrder}
            onChange={(e) => setByteOrder(e.target.value as ByteOrder)}
            className={selectClass}
          >
            {BYTE_ORDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label="Scan Rate (ms)" htmlFor="ed-tag-scan">
        <input
          id="ed-tag-scan"
          type="number"
          inputMode="numeric"
          min={50}
          step={50}
          autoComplete="off"
          value={scanRateMs}
          onChange={(e) => setScanRateMs(e.target.value)}
          className={monoClass}
        />
      </Row>
      <Row label="Deadband" htmlFor="ed-tag-deadband">
        <input
          id="ed-tag-deadband"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          autoComplete="off"
          value={deadband}
          onChange={(e) => setDeadband(e.target.value)}
          className={monoClass}
        />
      </Row>
      <Row label="Scaling" htmlFor="ed-tag-scaling">
        <input
          id="ed-tag-scaling"
          type="checkbox"
          checked={scalingEnabled}
          onChange={(e) => setScalingEnabled(e.target.checked)}
          className="h-3.5 w-3.5 accent-accent"
        />
      </Row>
      {scalingEnabled && (
        <>
          <Row label="Scaling Type" htmlFor="ed-tag-scaling-type">
            <select
              id="ed-tag-scaling-type"
              value={scalingType}
              onChange={(e) => setScalingType(e.target.value as 'linear' | 'square-root')}
              className={selectClass}
            >
              <option value="linear">Linear</option>
              <option value="square-root">Square Root</option>
            </select>
          </Row>
          <Row label="Raw Min" htmlFor="ed-tag-rawmin">
            <input id="ed-tag-rawmin" type="number" autoComplete="off" value={rawMin} onChange={(e) => setRawMin(e.target.value)} className={monoClass} />
          </Row>
          <Row label="Raw Max" htmlFor="ed-tag-rawmax">
            <input id="ed-tag-rawmax" type="number" autoComplete="off" value={rawMax} onChange={(e) => setRawMax(e.target.value)} className={monoClass} />
          </Row>
          <Row label="Eng Min" htmlFor="ed-tag-engmin">
            <input id="ed-tag-engmin" type="number" autoComplete="off" value={engMin} onChange={(e) => setEngMin(e.target.value)} className={monoClass} />
          </Row>
          <Row label="Eng Max" htmlFor="ed-tag-engmax">
            <input id="ed-tag-engmax" type="number" autoComplete="off" value={engMax} onChange={(e) => setEngMax(e.target.value)} className={monoClass} />
          </Row>
          <Row label="Clamp Low" htmlFor="ed-tag-clamplow">
            <input id="ed-tag-clamplow" type="checkbox" checked={clampLow} onChange={(e) => setClampLow(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          </Row>
          <Row label="Clamp High" htmlFor="ed-tag-clamphigh">
            <input id="ed-tag-clamphigh" type="checkbox" checked={clampHigh} onChange={(e) => setClampHigh(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          </Row>
          <Row label="Negate" htmlFor="ed-tag-negate">
            <input id="ed-tag-negate" type="checkbox" checked={negate} onChange={(e) => setNegate(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          </Row>
        </>
      )}
      <Row label="Description" htmlFor="ed-tag-description">
        <input
          id="ed-tag-description"
          type="text"
          autoComplete="off"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </Row>
      {mqttAgents.length > 0 && (
        <>
          <div className="border-b border-border bg-inset px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            MQTT Publishing
          </div>
          {mqttAgents.map((agent) => (
            <MqttAgentOverrideEditor
              key={agent.id}
              agent={agent}
              form={mqttForms[agent.id] ?? defaultMqttForm()}
              onChange={(patch) => patchMqttForm(agent.id, patch)}
            />
          ))}
        </>
      )}
      {lastError && (
        <Row label="Last Error">
          <span translate="no" className="break-words font-mono text-[12px]">
            {lastError}
          </span>
        </Row>
      )}
      <Row label="Write Value">
        {access === 'ro' ? (
          <span className="text-[11px] text-muted">Tag is read-only.</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setWriteOpen(true)}
              className="h-6 rounded-sm border border-border bg-inset px-2 text-[11px] enabled:hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            >
              Write…
            </button>
            <span className="truncate text-[11px] text-muted">
              Current:{' '}
              <span className="font-mono tabular-nums text-fg">
                {liveValue ? formatValue(liveValue.value) : '—'}
              </span>
            </span>
          </span>
        )}
      </Row>
      {writeOpen && <WriteValueDialog tag={buildConfig()} onClose={() => setWriteOpen(false)} />}
    </EditorShell>
  );
}

export function EntityInspector({ kind, entity, parentDriver, onSaved }: EntityInspectorProps) {
  if (kind === 'channel') {
    return <ChannelEditor entity={entity as Channel} onSaved={onSaved} />;
  }
  if (kind === 'device') {
    return <DeviceEditor entity={entity as Device} parentDriver={parentDriver} onSaved={onSaved} />;
  }
  return <TagEditor entity={entity as Tag} parentDriver={parentDriver} onSaved={onSaved} />;
}
