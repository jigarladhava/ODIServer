import { useState, type FormEvent, type ReactNode } from 'react';
import { updateEntity, writeValue } from '../lib/api-client';
import { BYTE_ORDER_OPTIONS, DATA_TYPE_LABELS, isRegisterDataType } from '../lib/labels';
import { useTagValues } from '../lib/live-values';
import type { ByteOrder, Channel, DataType, Device, Driver, EntityKind, Tag } from '../lib/types';

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

const DATA_TYPES: DataType[] = [
  'bool',
  'int16',
  'uint16',
  'int32',
  'uint32',
  'float32',
  'float64',
  'string',
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
  };
  const [name, setName] = useState(entity.name);
  const [enabled, setEnabled] = useState(entity.enabled);
  const [host, setHost] = useState(settings.host ?? '');
  const [port, setPort] = useState(String(settings.port ?? 502));
  const [unitId, setUnitId] = useState(String(settings.unitId ?? 1));
  const [blockReads, setBlockReads] = useState(settings.blockReads ?? true);
  const [maxBlockSize, setMaxBlockSize] = useState(String(settings.maxBlockSize ?? 120));
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

function TagEditor({ entity, onSaved }: { entity: Tag; onSaved: () => void }) {
  const [name, setName] = useState(entity.name);
  const [address, setAddress] = useState(entity.address);
  const [dataType, setDataType] = useState<DataType>(entity.dataType);
  const [byteOrder, setByteOrder] = useState<ByteOrder>(entity.byteOrder ?? 'big-endian');
  const [scanRateMs, setScanRateMs] = useState(String(entity.scanRateMs));
  const [deadband, setDeadband] = useState(String(entity.deadband));
  const [scalingEnabled, setScalingEnabled] = useState(entity.scaling.enabled);
  const [rawMin, setRawMin] = useState(String(entity.scaling.rawMin));
  const [rawMax, setRawMax] = useState(String(entity.scaling.rawMax));
  const [engMin, setEngMin] = useState(String(entity.scaling.engMin));
  const [engMax, setEngMax] = useState(String(entity.scaling.engMax));
  const [description, setDescription] = useState(entity.description);
  const { busy, error, saved, save } = useSave(onSaved);

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
            ...(isRegisterDataType(dataType) ? { byteOrder } : {}),
            scanRateMs: Number(scanRateMs),
            deadband: Number(deadband),
            scaling: {
              enabled: scalingEnabled,
              rawMin: Number(rawMin),
              rawMax: Number(rawMax),
              engMin: Number(engMin),
              engMax: Number(engMax),
            },
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
      <Row label="Address" htmlFor="ed-tag-address">
        <input
          id="ed-tag-address"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="40001"
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
      {isRegisterDataType(dataType) && (
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
          inputMode="numeric"
          min={0}
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
      {lastError && (
        <Row label="Last Error">
          <span translate="no" className="break-words font-mono text-[12px]">
            {lastError}
          </span>
        </Row>
      )}
      <Row label="Write Value" htmlFor="ed-tag-write">
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
  return <TagEditor entity={entity as Tag} onSaved={onSaved} />;
}
