import { useEffect, useRef, useState } from 'react';
import { writeValue } from '../lib/api-client';
import { formatValue } from '../lib/format';
import { useTagValues } from '../lib/live-values';
import type { Tag } from '../lib/types';
import { Modal } from './Modal';
import { QualityBadge } from './QualityBadge';

export function parseWriteValue(raw: string): number | boolean | string {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return raw;
}

const ECHO_TIMEOUT_MS = 8000;

const focusRing =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

/**
 * Deliberate write confirmation: shows the tag, its current live value, and
 * the requested new value before committing. After the write is accepted the
 * dialog stays open and watches the live feed for the driver ack — the value
 * actually landing on the tag — before reporting success.
 */
export function WriteValueDialog({
  tag,
  onClose,
  onWritten,
}: {
  tag: Tag;
  onClose: () => void;
  onWritten?: () => void;
}) {
  const { values } = useTagValues();
  const current = values[tag.id];
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [echo, setEcho] = useState<'waiting' | 'confirmed' | 'timeout' | null>(null);
  const writeStartRef = useRef(0);
  const wroteValueRef = useRef<number | boolean | string | null>(null);

  const onConfirm = async () => {
    if (!raw.trim()) {
      setError('Enter a value to write.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const parsed = parseWriteValue(raw);
      wroteValueRef.current = parsed;
      writeStartRef.current = Date.now();
      await writeValue(tag.id, parsed);
      setEcho('waiting');
      onWritten?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Write echo: watch the live value for a change after the write was accepted.
  useEffect(() => {
    if (echo !== 'waiting') return;
    const v = values[tag.id];
    if (
      v &&
      v.timestamp >= writeStartRef.current &&
      v.value === wroteValueRef.current &&
      v.quality === 'good'
    ) {
      setEcho('confirmed');
      return;
    }
    const timer = window.setTimeout(() => setEcho('timeout'), ECHO_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [echo, values, tag.id]);

  return (
    <Modal open title={`Write Value — ${tag.name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (echo === null) void onConfirm();
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1 text-[12px]">
          <p>
            <span className="text-muted">Tag: </span>
            <span translate="no" className="font-mono font-medium">
              {tag.name}
            </span>
            <span className="text-muted"> ({tag.address})</span>
          </p>
          <p className="flex items-center gap-1.5">
            <span className="text-muted">Current value: </span>
            {current ? (
              <>
                <span className="font-mono tabular-nums">{formatValue(current.value)}</span>
                <QualityBadge quality={current.quality} />
              </>
            ) : (
              <span className="text-muted">—</span>
            )}
          </p>
        </div>

        {echo === null && (
          <label className="flex items-center gap-2 text-[12px]">
            <span className="text-muted">New value</span>
            <input
              type="text"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              aria-label="New value"
              className={`h-7 w-40 rounded-sm border border-border bg-inset px-1.5 font-mono text-[12px] text-fg ${focusRing}`}
            />
          </label>
        )}

        <p className="text-[11px] text-muted">
          Writing drives an output on the connected device. Confirm the value before proceeding.
        </p>

        {error && (
          <p role="alert" className="whitespace-pre-wrap rounded-sm border border-bad/40 bg-bad-bg px-2 py-1.5 font-mono text-[11px] text-bad">
            {error}
          </p>
        )}
        {echo === 'waiting' && (
          <p role="status" className="rounded-sm border border-border bg-inset px-2 py-1.5 text-[12px] text-muted">
            Write accepted — waiting for the device to echo the new value…
          </p>
        )}
        {echo === 'confirmed' && current && (
          <p role="status" className="rounded-sm border border-good/40 bg-good-bg px-2 py-1.5 text-[12px] text-good">
            Write echoed: value is now{' '}
            <span className="font-mono font-medium">{formatValue(current.value)}</span> (good
            quality).
          </p>
        )}
        {echo === 'timeout' && (
          <p role="alert" className="rounded-sm border border-uncertain bg-uncertain-bg px-2 py-1.5 text-[12px] text-uncertain">
            No echo within {ECHO_TIMEOUT_MS / 1000}s — the write may not have reached the device.
            Check the tag's quality and the Event Log.
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2 border-t border-border pt-2.5">
          <button
            type="button"
            onClick={onClose}
            className={`h-7 rounded-sm border border-border bg-inset px-3 text-[12px] hover:bg-hover ${focusRing}`}
          >
            {echo === null ? 'Cancel' : 'Close'}
          </button>
          {echo === null && (
            <button
              type="submit"
              disabled={busy}
              className={`h-7 rounded-sm border border-bad bg-bad px-3 text-[12px] font-medium text-white enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
            >
              {busy ? 'Writing…' : 'Confirm Write'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
