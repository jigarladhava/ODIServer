import { useState, type FormEvent, type ReactNode } from 'react';
import { createEntity } from '../lib/api-client';
import { slugify, uniqueId } from '../lib/ids';
import { BYTE_ORDER_OPTIONS, DATA_TYPE_LABELS, DATA_TYPE_OPTIONS, isRegisterDataType } from '../lib/labels';
import { useProject } from '../lib/project';
import type { ByteOrder, Channel, DataType, Device, Driver, EntityKind, Tag, TagAccess } from '../lib/types';
import { Modal } from './Modal';

export interface CreateTarget {
  kind: EntityKind;
  /** Parent channel id (device) or device id (tag). Undefined for channels. */
  parentId?: string;
}

interface EntityModalProps {
  target: CreateTarget | null;
  onClose: () => void;
  onCreated: (target: CreateTarget, id: string) => void;
}

export const inputClass =
  'h-7 w-full rounded-sm border border-border bg-inset px-2 text-[12px] text-fg placeholder:text-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

const selectClass =
  'h-7 w-full rounded-sm border border-border bg-inset px-1.5 text-[12px] text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

const DRIVERS: { value: Driver; label: string }[] = [
  { value: 'modbus-tcp', label: 'Modbus TCP/IP Ethernet' },
  { value: 'modbus-rtu', label: 'Modbus RTU Serial' },
  { value: 'opcua-client', label: 'OPC UA Client' },
];

const DATA_TYPES: DataType[] = DATA_TYPE_OPTIONS;

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-[12px] text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function FormActions({
  busy,
  submitLabel,
  error,
  onClose,
}: {
  busy: boolean;
  submitLabel: string;
  error: string;
  onClose: () => void;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-bad">
          {error}
        </p>
      )}
      <div className="mt-1 flex justify-end gap-2 border-t border-border pt-2.5">
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded-sm border border-border bg-inset px-3 text-[12px] hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="h-7 rounded-sm border border-accent bg-accent px-3 text-[12px] font-medium text-accent-fg enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </>
  );
}

function CheckboxRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-[12px]">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-accent"
      />
      {label}
    </label>
  );
}

function ChannelForm({
  parentId: _parentId,
  onClose,
  onCreated,
}: {
  parentId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { project } = useProject();
  const [name, setName] = useState('');
  const [driver, setDriver] = useState<Driver>('modbus-tcp');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const idPreview = uniqueId(slugify(name || 'channel'), (project?.channels ?? []).map((c) => c.id));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a channel name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const channel: Channel = {
        id: idPreview,
        name: name.trim(),
        driver,
        enabled,
        settings: {},
      };
      const saved = await createEntity<Channel>('channel', channel);
      onCreated(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
      <Field label="Channel Name" htmlFor="new-channel-name">
        <input
          id="new-channel-name"
          name="channelName"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. Modbus_TCP_Line2"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError('');
          }}
          className={`${inputClass} font-mono`}
        />
      </Field>
      <p className="-mt-1 text-[11px] text-muted">
        ID: <span translate="no" className="font-mono">{idPreview}</span>
      </p>
      <Field label="Device Driver" htmlFor="new-channel-driver">
        <select
          id="new-channel-driver"
          name="channelDriver"
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
      </Field>
      <CheckboxRow id="new-channel-enabled" label="Enabled" checked={enabled} onChange={setEnabled} />
      <FormActions busy={busy} submitLabel="Create Channel" error={error} onClose={onClose} />
    </form>
  );
}

function DeviceForm({
  parentId,
  onClose,
  onCreated,
}: {
  parentId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { project } = useProject();
  const channel = project?.channels.find((c) => c.id === parentId);
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('502');
  const [unitId, setUnitId] = useState('1');
  const [blockReads, setBlockReads] = useState(true);
  const [maxBlockSize, setMaxBlockSize] = useState('120');
  const [requestTimeoutMs, setRequestTimeoutMs] = useState('1000');
  const [interRequestDelayMs, setInterRequestDelayMs] = useState('0');
  const [scanMode, setScanMode] = useState('respect-tag');
  const [scanModeRateMs, setScanModeRateMs] = useState('1000');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const idPreview = uniqueId(slugify(name || 'device'), (project?.devices ?? []).map((d) => d.id));
  const isTcp = channel?.driver === 'modbus-tcp';
  const isRtu = channel?.driver === 'modbus-rtu';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a device name.');
      return;
    }
    if (!channel) {
      setError('Select a channel in the tree first.');
      return;
    }
    const portNum = Number(port);
    const unitNum = Number(unitId);
    if (isTcp && !host.trim()) {
      setError('Enter the device host (IP address or hostname).');
      return;
    }
    if (isTcp && (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)) {
      setError('Port must be an integer between 1 and 65535.');
      return;
    }
    if (!Number.isInteger(unitNum) || unitNum < 0 || unitNum > 255) {
      setError('Unit ID must be an integer between 0 and 255.');
      return;
    }
    const blockSizeNum = Number(maxBlockSize);
    if ((isTcp || isRtu) && (!Number.isInteger(blockSizeNum) || blockSizeNum < 1 || blockSizeNum > 120)) {
      setError('Max block size must be an integer between 1 and 120.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const settings: Record<string, unknown> = {};
      if (isTcp) Object.assign(settings, { host: host.trim(), port: portNum, unitId: unitNum });
      else if (isRtu) settings.unitId = unitNum;
      if (isTcp || isRtu)
        Object.assign(settings, {
          blockReads,
          maxBlockSize: blockSizeNum,
          requestTimeoutMs: Number(requestTimeoutMs) || 1000,
          interRequestDelayMs: Number(interRequestDelayMs) || 0,
          scanMode,
          scanModeRateMs: Number(scanModeRateMs) || 1000,
        });
      const device: Device = {
        id: idPreview,
        channelId: channel.id,
        name: name.trim(),
        enabled,
        settings,
      };
      const saved = await createEntity<Device>('device', device);
      onCreated(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
      <p className="text-[11px] text-muted">
        Channel:{' '}
        <span translate="no" className="font-mono text-fg">
          {channel?.name ?? '—'}
        </span>
      </p>
      <Field label="Device Name" htmlFor="new-device-name">
        <input
          id="new-device-name"
          name="deviceName"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. PLC-03"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError('');
          }}
          className={`${inputClass} font-mono`}
        />
      </Field>
      <p className="-mt-1 text-[11px] text-muted">
        ID: <span translate="no" className="font-mono">{idPreview}</span>
      </p>
      {isTcp && (
        <>
          <Field label="Host" htmlFor="new-device-host">
            <input
              id="new-device-host"
              name="deviceHost"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="e.g. 192.168.1.12"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </Field>
          <Field label="Port" htmlFor="new-device-port">
            <input
              id="new-device-port"
              name="devicePort"
              type="number"
              inputMode="numeric"
              min={1}
              max={65535}
              autoComplete="off"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className={`${inputClass} font-mono tabular-nums`}
            />
          </Field>
        </>
      )}
      {(isTcp || isRtu) && (
        <>
          <Field label="Unit ID" htmlFor="new-device-unit">
            <input
              id="new-device-unit"
              name="deviceUnitId"
              type="number"
              inputMode="numeric"
              min={0}
              max={255}
              autoComplete="off"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className={`${inputClass} font-mono tabular-nums`}
            />
          </Field>
          <CheckboxRow
            id="new-device-block-reads"
            label="Block reads (coalesce adjacent tags)"
            checked={blockReads}
            onChange={setBlockReads}
          />
          <Field label="Max Block Size" htmlFor="new-device-max-block">
            <input
              id="new-device-max-block"
              name="deviceMaxBlockSize"
              type="number"
              inputMode="numeric"
              min={1}
              max={120}
              autoComplete="off"
              disabled={!blockReads}
              value={maxBlockSize}
              onChange={(e) => setMaxBlockSize(e.target.value)}
              className={`${inputClass} font-mono tabular-nums`}
            />
          </Field>
          <Field label="Request Timeout (ms)" htmlFor="new-device-req-timeout">
            <input
              id="new-device-req-timeout"
              type="number"
              inputMode="numeric"
              min={1}
              autoComplete="off"
              value={requestTimeoutMs}
              onChange={(e) => setRequestTimeoutMs(e.target.value)}
              className={`${inputClass} font-mono tabular-nums`}
            />
          </Field>
          <Field label="Inter-Request Delay (ms)" htmlFor="new-device-req-delay">
            <input
              id="new-device-req-delay"
              type="number"
              inputMode="numeric"
              min={0}
              autoComplete="off"
              value={interRequestDelayMs}
              onChange={(e) => setInterRequestDelayMs(e.target.value)}
              className={`${inputClass} font-mono tabular-nums`}
            />
          </Field>
          <Field label="Scan Mode" htmlFor="new-device-scan-mode">
            <select
              id="new-device-scan-mode"
              value={scanMode}
              onChange={(e) => setScanMode(e.target.value)}
              className={selectClass}
            >
              <option value="respect-tag">Respect tag-specified scan rate</option>
              <option value="respect-device">Request all data at device rate</option>
            </select>
          </Field>
          {scanMode === 'respect-device' && (
            <Field label="Device Scan Rate (ms)" htmlFor="new-device-scan-rate">
              <input
                id="new-device-scan-rate"
                type="number"
                inputMode="numeric"
                min={50}
                step={50}
                autoComplete="off"
                value={scanModeRateMs}
                onChange={(e) => setScanModeRateMs(e.target.value)}
                className={`${inputClass} font-mono tabular-nums`}
              />
            </Field>
          )}
        </>
      )}
      <CheckboxRow id="new-device-enabled" label="Enabled" checked={enabled} onChange={setEnabled} />
      <FormActions busy={busy} submitLabel="Create Device" error={error} onClose={onClose} />
    </form>
  );
}

function TagForm({
  parentId,
  onClose,
  onCreated,
}: {
  parentId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { project } = useProject();
  const device = project?.devices.find((d) => d.id === parentId);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [dataType, setDataType] = useState<DataType>('uint16');
  const [byteOrder, setByteOrder] = useState<ByteOrder>('big-endian');
  const [access, setAccess] = useState<TagAccess>('rw');
  const [scanRateMs, setScanRateMs] = useState('1000');
  const [deadband, setDeadband] = useState('0');
  const [scalingEnabled, setScalingEnabled] = useState(false);
  const [scalingType, setScalingType] = useState<'linear' | 'square-root'>('linear');
  const [rawMin, setRawMin] = useState('0');
  const [rawMax, setRawMax] = useState('65535');
  const [engMin, setEngMin] = useState('0');
  const [engMax, setEngMax] = useState('100');
  const [clampLow, setClampLow] = useState(false);
  const [clampHigh, setClampHigh] = useState(false);
  const [negate, setNegate] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const idPreview = uniqueId(slugify(name || 'tag'), (project?.tags ?? []).map((t) => t.id));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a tag name.');
      return;
    }
    if (!device) {
      setError('Select a device in the tree first.');
      return;
    }
    if (!address.trim()) {
      setError('Enter a Modbus address (e.g. 40001).');
      return;
    }
    const scanNum = Number(scanRateMs);
    if (!Number.isFinite(scanNum) || scanNum < 50) {
      setError('Scan rate must be at least 50 ms.');
      return;
    }
    const deadbandNum = Number(deadband);
    if (!Number.isFinite(deadbandNum) || deadbandNum < 0) {
      setError('Deadband must be a non-negative number.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const tag: Tag = {
        id: idPreview,
        deviceId: device.id,
        name: name.trim(),
        address: address.trim(),
        dataType,
        ...(isRegisterDataType(dataType) ? { byteOrder } : {}),
        access,
        scanRateMs: scanNum,
        deadband: deadbandNum,
        scaling: {
          enabled: scalingEnabled,
          type: scalingType,
          rawMin: Number(rawMin) || 0,
          rawMax: Number(rawMax) || 0,
          engMin: Number(engMin) || 0,
          engMax: Number(engMax) || 0,
          clampLow,
          clampHigh,
          negate,
        },
        description: description.trim(),
      };
      const saved = await createEntity<Tag>('tag', tag);
      onCreated(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
      <p className="text-[11px] text-muted">
        Device:{' '}
        <span translate="no" className="font-mono text-fg">
          {device?.name ?? '—'}
        </span>
      </p>
      <Field label="Tag Name" htmlFor="new-tag-name">
        <input
          id="new-tag-name"
          name="tagName"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. Line1.Speed"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError('');
          }}
          className={`${inputClass} font-mono`}
        />
      </Field>
      <p className="-mt-1 text-[11px] text-muted">
        ID: <span translate="no" className="font-mono">{idPreview}</span>
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Address" htmlFor="new-tag-address">
          <input
            id="new-tag-address"
            name="tagAddress"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="40001"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </Field>
        <Field label="Data Type" htmlFor="new-tag-datatype">
          <select
            id="new-tag-datatype"
            name="tagDataType"
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
        </Field>
        <Field label="Access" htmlFor="new-tag-access">
          <select
            id="new-tag-access"
            name="tagAccess"
            value={access}
            onChange={(e) => setAccess(e.target.value as TagAccess)}
            className={selectClass}
          >
            <option value="ro">Read Only</option>
            <option value="rw">Read/Write</option>
          </select>
        </Field>
        {isRegisterDataType(dataType) && (
          <Field label="Byte Order" htmlFor="new-tag-byteorder">
            <select
              id="new-tag-byteorder"
              name="tagByteOrder"
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
          </Field>
        )}
        <Field label="Scan Rate (ms)" htmlFor="new-tag-scan">
          <input
            id="new-tag-scan"
            name="tagScanRate"
            type="number"
            inputMode="numeric"
            min={50}
            step={50}
            autoComplete="off"
            value={scanRateMs}
            onChange={(e) => setScanRateMs(e.target.value)}
            className={`${inputClass} font-mono tabular-nums`}
          />
        </Field>
        <Field label="Deadband" htmlFor="new-tag-deadband">
          <input
            id="new-tag-deadband"
            name="tagDeadband"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            autoComplete="off"
            value={deadband}
            onChange={(e) => setDeadband(e.target.value)}
            className={`${inputClass} font-mono tabular-nums`}
          />
        </Field>
      </div>
      <CheckboxRow
        id="new-tag-scaling"
        label="Scaling enabled"
        checked={scalingEnabled}
        onChange={setScalingEnabled}
      />
      {scalingEnabled && (
        <div className="grid grid-cols-2 gap-2.5 rounded-sm border border-border bg-panel p-2.5">
          <Field label="Scaling Type" htmlFor="new-tag-scaling-type">
            <select id="new-tag-scaling-type" value={scalingType} onChange={(e) => setScalingType(e.target.value as 'linear' | 'square-root')} className={selectClass}>
              <option value="linear">Linear</option>
              <option value="square-root">Square Root</option>
            </select>
          </Field>
          <Field label="Raw Min" htmlFor="new-tag-rawmin">
            <input id="new-tag-rawmin" type="number" autoComplete="off" value={rawMin} onChange={(e) => setRawMin(e.target.value)} className={`${inputClass} font-mono tabular-nums`} />
          </Field>
          <Field label="Raw Max" htmlFor="new-tag-rawmax">
            <input id="new-tag-rawmax" type="number" autoComplete="off" value={rawMax} onChange={(e) => setRawMax(e.target.value)} className={`${inputClass} font-mono tabular-nums`} />
          </Field>
          <Field label="Eng Min" htmlFor="new-tag-engmin">
            <input id="new-tag-engmin" type="number" autoComplete="off" value={engMin} onChange={(e) => setEngMin(e.target.value)} className={`${inputClass} font-mono tabular-nums`} />
          </Field>
          <Field label="Eng Max" htmlFor="new-tag-engmax">
            <input id="new-tag-engmax" type="number" autoComplete="off" value={engMax} onChange={(e) => setEngMax(e.target.value)} className={`${inputClass} font-mono tabular-nums`} />
          </Field>
          <div className="col-span-2 flex gap-4">
            <CheckboxRow id="new-tag-clamplow" label="Clamp low" checked={clampLow} onChange={setClampLow} />
            <CheckboxRow id="new-tag-clamphigh" label="Clamp high" checked={clampHigh} onChange={setClampHigh} />
            <CheckboxRow id="new-tag-negate" label="Negate" checked={negate} onChange={setNegate} />
          </div>
        </div>
      )}
      <Field label="Description" htmlFor="new-tag-description">
        <input
          id="new-tag-description"
          name="tagDescription"
          type="text"
          autoComplete="off"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </Field>
      <FormActions busy={busy} submitLabel="Create Tag" error={error} onClose={onClose} />
    </form>
  );
}

export function EntityModal({ target, onClose, onCreated }: EntityModalProps) {
  if (!target) return null;
  const title =
    target.kind === 'channel' ? 'New Channel' : target.kind === 'device' ? 'New Device' : 'New Tag';
  return (
    <Modal open title={title} onClose={onClose}>
      {target.kind === 'channel' && (
        <ChannelForm parentId={target.parentId} onClose={onClose} onCreated={(id) => onCreated(target, id)} />
      )}
      {target.kind === 'device' && (
        <DeviceForm parentId={target.parentId} onClose={onClose} onCreated={(id) => onCreated(target, id)} />
      )}
      {target.kind === 'tag' && (
        <TagForm parentId={target.parentId} onClose={onClose} onCreated={(id) => onCreated(target, id)} />
      )}
    </Modal>
  );
}
