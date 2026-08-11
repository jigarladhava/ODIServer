import { useEffect, useRef, useState } from 'react';
import {
  importDevice,
  importProject,
  importTags,
  type ImportResult,
} from '../lib/api-client';
import { Modal } from './Modal';

export type ImportKind = 'project' | 'device' | 'tags';

export interface ImportTarget {
  kind: ImportKind;
  /** Target channel (device import) or device (tag import). */
  parentId?: string;
  /** Display name of the parent, for the dialog subtitle. */
  parentName?: string;
}

interface ImportModalProps {
  target: ImportTarget | null;
  onClose: () => void;
  onImported: (target: ImportTarget, result: ImportResult) => void;
}

const TITLES: Record<ImportKind, string> = {
  project: 'Open Project',
  device: 'Import Device',
  tags: 'Import Tags',
};

const ACCEPT: Record<ImportKind, string> = {
  project: '.json,application/json',
  device: '.json,application/json',
  tags: '.csv,.json,text/csv,application/json',
};

const HINTS: Record<ImportKind, string> = {
  project: 'Select an ODIServer project file (.json) previously saved from this console.',
  device: 'Select a device export file (.json). The device and its tags are added to the target channel.',
  tags: 'Select a tag file (.csv or .json). Tags are upserted into the target device by id.',
};

const focusRing =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

function summarize(result: ImportResult): string {
  const parts: string[] = [];
  if (result.imported.channels !== undefined) parts.push(`${result.imported.channels} channel(s)`);
  if (result.imported.devices !== undefined) parts.push(`${result.imported.devices} device(s)`);
  if (result.imported.tags !== undefined) parts.push(`${result.imported.tags} tag(s)`);
  return parts.length > 0 ? `Imported ${parts.join(', ')}.` : 'Import complete.';
}

export function ImportModal({ target, onClose, onImported }: ImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset local state whenever a new import target opens the dialog.
  useEffect(() => {
    setFile(null);
    setMode('replace');
    setBusy(false);
    setError('');
    setResult('');
  }, [target]);

  if (!target) return null;

  const runImport = async () => {
    if (!file) {
      setError('Select a file to import.');
      return;
    }
    setBusy(true);
    setError('');
    setResult('');
    try {
      const text = await file.text();
      let importResult: ImportResult;
      if (target.kind === 'project') {
        importResult = await importProject(JSON.parse(text), mode);
      } else if (target.kind === 'device') {
        importResult = await importDevice(JSON.parse(text), target.parentId);
      } else {
        const isCsv = file.name.toLowerCase().endsWith('.csv');
        importResult = await importTags(
          target.parentId ?? '',
          isCsv ? text : (JSON.parse(text) as unknown[]),
        );
      }
      setResult(summarize(importResult));
      onImported(target, importResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={TITLES[target.kind]} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void runImport();
        }}
        className="flex flex-col gap-3"
      >
        <p className="text-[12px] text-muted">
          {HINTS[target.kind]}
          {target.parentName && (
            <>
              {' '}
              Target: <span className="font-mono text-fg">{target.parentName}</span>
            </>
          )}
        </p>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT[target.kind]}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError('');
              setResult('');
            }}
            className="w-full text-[12px] file:mr-2 file:h-7 file:rounded-sm file:border file:border-border file:bg-inset file:px-3 file:text-[12px] file:text-fg hover:file:bg-hover"
            aria-label="File to import"
          />
        </div>

        {target.kind === 'project' && (
          <fieldset className="rounded-sm border border-border px-2.5 py-2">
            <legend className="px-1 text-[11px] text-muted">Import mode</legend>
            <label className="flex cursor-pointer items-start gap-2 py-0.5 text-[12px]">
              <input
                type="radio"
                name="import-mode"
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
                className="mt-0.5 h-3.5 w-3.5 accent-accent"
              />
              <span>
                <span className="font-medium">Replace project</span>
                <span className="block text-[11px] text-muted">
                  Removes all existing channels, devices, and tags first.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 py-0.5 text-[12px]">
              <input
                type="radio"
                name="import-mode"
                checked={mode === 'merge'}
                onChange={() => setMode('merge')}
                className="mt-0.5 h-3.5 w-3.5 accent-accent"
              />
              <span>
                <span className="font-medium">Merge into project</span>
                <span className="block text-[11px] text-muted">
                  Upserts imported entities; existing entities with other ids are kept.
                </span>
              </span>
            </label>
          </fieldset>
        )}

        {error && (
          <p
            role="alert"
            className="max-h-28 overflow-auto whitespace-pre-wrap rounded-sm border border-bad/40 bg-bad-bg px-2 py-1.5 font-mono text-[11px] text-bad"
          >
            {error}
          </p>
        )}
        {result && (
          <p role="status" className="rounded-sm border border-good/40 bg-good-bg px-2 py-1.5 text-[12px] text-good">
            {result}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2 border-t border-border pt-2.5">
          <button
            type="button"
            onClick={onClose}
            className={`h-7 rounded-sm border border-border bg-inset px-3 text-[12px] hover:bg-hover ${focusRing}`}
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          <button
            type="submit"
            disabled={busy || !file}
            className={`h-7 rounded-sm border border-accent bg-accent px-3 text-[12px] font-medium text-accent-fg enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
