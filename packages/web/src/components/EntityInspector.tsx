import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { getMqttAgents, updateEntity, writeValue } from '../lib/api-client';
import { BYTE_ORDER_OPTIONS, DATA_TYPE_LABELS, DATA_TYPE_OPTIONS, isRegisterDataType } from '../lib/labels';
import { useTagValues } from '../lib/live-values';
import type { ByteOrder, Channel, DataType, Device, Driver, EntityKind, MqttAgent, MqttTagOverride, Tag, TagAccess } from '../lib/types';

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
  children,
}: {
  title: string;
  onSubmit: (e: FormEvent) => void;
  busy: boolean;
  error: string;
  saved: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex h-full flex-col bg-panel">
      <h2 className="border-b border-border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {title}
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

function ChannelEditor({ entity, onSaved }: { entity: Channel; onSaved: () => void }) {
  const [name, setName] = useState(entity.name);
  const [driver, setDriver] = useState<Driver>(entity.driver);
  const [enabled, setEnabled] = useState(entity.enabled);
  const { busy, error, saved, save } = useSave(onSaved);

  return (
    <EditorShell
      title={`Channel — ${entity.name}`}
      busy={busy}
      error={error}
      saved={saved}
      onSubmit={(e) => {
        e.preventDefault();
        void save(() =>
          updateEntity('channel', entity.id, { ...entity, name: name.trim(), driver, enabled }),
        );
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

  return (
    <EditorShell
      title={`Device — ${entity.name}`}
      busy={busy}
      error={error}
      saved={saved}
      onSubmit={(e) => {
        e.preventDefault();
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
        void save(() =>
          updateEntity('device', entity.id, {
            ...entity,
            name: name.trim(),
            enabled,
            settings: nextSettings,
          }),
        );
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

function parseWriteValue(raw: string): number | boolean | string {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return raw;
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

  const [writeRaw, setWriteRaw] = useState('');
  const [writeNote, setWriteNote] = useState('');
  const [writeBusy, setWriteBusy] = useState(false);

  const { values } = useTagValues();
  const lastError = values[entity.id]?.error;

  const onWrite = async () => {
    if (!writeRaw.trim()) {
      setWriteNote('Enter a value to write.');
      return;
    }
    setWriteBusy(true);
    setWriteNote('');
    try {
      await writeValue(entity.id, parseWriteValue(writeRaw));
      setWriteNote('Write queued.');
    } catch (err) {
      setWriteNote(err instanceof Error ? err.message : String(err));
    } finally {
      setWriteBusy(false);
    }
  };

  return (
    <EditorShell
      title={`Tag — ${entity.name}`}
      busy={busy}
      error={error}
      saved={saved}
      onSubmit={(e) => {
        e.preventDefault();
        void save(() =>
          updateEntity('tag', entity.id, {
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
          }),
        );
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
      <Row label="Write Value" htmlFor="ed-tag-write">
        {access === 'ro' ? (
          <span className="text-[11px] text-muted">Tag is read-only.</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <input
              id="ed-tag-write"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="value…"
              value={writeRaw}
              onChange={(e) => setWriteRaw(e.target.value)}
              className={`${monoClass} max-w-40`}
            />
            <button
              type="button"
              onClick={onWrite}
              disabled={writeBusy}
              className="h-6 rounded-sm border border-border bg-inset px-2 text-[11px] enabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            >
              {writeBusy ? 'Writing…' : 'Write'}
            </button>
            <span aria-live="polite" className="truncate text-[11px] text-muted" title={writeNote}>
              {writeNote}
            </span>
          </span>
        )}
      </Row>
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
