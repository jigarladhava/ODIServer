import { useEffect, useRef, useState } from 'react';
import {
  getImporterPlugins,
  importDevice,
  importProject,
  importProjectWithPlugin,
  importTags,
  type ImporterInfo,
  type ImportResult,
} from '../lib/api-client';
import { useProject } from '../lib/project';
import type { Project } from '../lib/types';
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

interface EntityDiff {
  added: string[];
  modified: string[];
  removed: string[];
}

interface ProjectDiff {
  channels: EntityDiff;
  devices: EntityDiff;
  tags: EntityDiff;
  totalChanges: number;
}

type EntityList = { id: string; name?: string }[];

function diffEntities(current: EntityList, incoming: EntityList): EntityDiff {
  const currentById = new Map(current.map((e) => [e.id, e]));
  const incomingById = new Map(incoming.map((e) => [e.id, e]));
  const label = (e: { name?: string; id: string }) => e.name ?? e.id;
  const added = incoming.filter((e) => !currentById.has(e.id)).map(label);
  const modified = incoming
    .filter((e) => {
      const existing = currentById.get(e.id);
      return existing !== undefined && JSON.stringify(existing) !== JSON.stringify(e);
    })
    .map(label);
  const removed = current.filter((e) => !incomingById.has(e.id)).map(label);
  return { added, modified, removed };
}

/** Client-side preview of what a native project file would change. */
function diffProject(current: Project, incoming: Project): ProjectDiff {
  const channels = diffEntities(current.channels, incoming.channels ?? []);
  const devices = diffEntities(current.devices, incoming.devices ?? []);
  const tags = diffEntities(current.tags, incoming.tags ?? []);
  const totalChanges =
    channels.added.length + channels.modified.length + channels.removed.length +
    devices.added.length + devices.modified.length + devices.removed.length +
    tags.added.length + tags.modified.length + tags.removed.length;
  return { channels, devices, tags, totalChanges };
}

function DiffLine({ label, diff }: { label: string; diff: EntityDiff }) {
  if (diff.added.length + diff.modified.length + diff.removed.length === 0) {
    return (
      <p className="text-[11px] text-muted">
        {label}: <span>no changes</span>
      </p>
    );
  }
  const sample = (names: string[]) =>
    names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3} more` : names.join(', ');
  return (
    <div className="text-[11px]">
      <span className="text-muted">{label}: </span>
      {diff.added.length > 0 && (
        <span className="text-good" title={diff.added.join('\n')}>
          +{diff.added.length} added ({sample(diff.added)}){' '}
        </span>
      )}
      {diff.modified.length > 0 && (
        <span className="text-uncertain" title={diff.modified.join('\n')}>
          ~{diff.modified.length} modified ({sample(diff.modified)}){' '}
        </span>
      )}
      {diff.removed.length > 0 && (
        <span className="text-bad" title={diff.removed.join('\n')}>
          −{diff.removed.length} removed ({sample(diff.removed)})
        </span>
      )}
    </div>
  );
}

export function ImportModal({ target, onClose, onImported }: ImportModalProps) {
  const { project } = useProject();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<string>('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [importers, setImporters] = useState<ImporterInfo[]>([]);
  const [format, setFormat] = useState<string>('odiserver');
  const [preview, setPreview] = useState<ProjectDiff | null>(null);
  const [replaceConfirm, setReplaceConfirm] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Third-party project formats appear only when a server-side importer
  // plugin is installed; otherwise the select stays hidden.
  useEffect(() => {
    if (target?.kind !== 'project') return;
    let cancelled = false;
    getImporterPlugins()
      .then((list) => {
        if (!cancelled) setImporters(list);
      })
      .catch(() => {
        // importer listing is best-effort; fall back to the native format
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  // Reset local state whenever a new import target opens the dialog.
  useEffect(() => {
    setFile(null);
    setMode('replace');
    setBusy(false);
    setError('');
    setResult('');
    setWarnings([]);
    setFormat('odiserver');
    setPreview(null);
    setReplaceConfirm('');
  }, [target]);

  // Native-format project files are parsed locally to preview the diff
  // against the current project before anything is committed.
  useEffect(() => {
    setPreview(null);
    if (!file || target?.kind !== 'project' || format !== 'odiserver' || !project) return;
    let cancelled = false;
    file
      .text()
      .then((text) => {
        if (cancelled) return;
        const incoming = JSON.parse(text) as Project;
        setPreview(diffProject(project, incoming));
      })
      .catch(() => {
        // Unparseable files surface as an import error when submitted; no preview.
      });
    return () => {
      cancelled = true;
    };
  }, [file, target, format, project]);

  if (!target) return null;

  const replaceConfirmed = mode !== 'replace' || replaceConfirm === 'REPLACE';

  const runImport = async () => {
    if (!file) {
      setError('Select a file to import.');
      return;
    }
    setBusy(true);
    setError('');
    setResult('');
    setWarnings([]);
    try {
      const text = await file.text();
      let importResult: ImportResult;
      if (target.kind === 'project') {
        importResult =
          format === 'odiserver'
            ? await importProject(JSON.parse(text), mode)
            : await importProjectWithPlugin(format, text, mode);
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
      setWarnings(importResult.warnings ?? []);
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
          {target.kind === 'project' && format !== 'odiserver'
            ? `Select a ${importers.find((i) => i.id === format)?.name ?? 'third-party'} file to convert and open.`
            : HINTS[target.kind]}
          {target.parentName && (
            <>
              {' '}
              Target: <span className="font-mono text-fg">{target.parentName}</span>
            </>
          )}
        </p>

        {target.kind === 'project' && importers.length > 0 && (
          <label className="flex items-center gap-2 text-[12px]">
            <span className="text-muted">File format</span>
            <select
              value={format}
              onChange={(e) => {
                setFormat(e.target.value);
                setError('');
                setResult('');
                setWarnings([]);
              }}
              aria-label="File format"
              className={`h-7 rounded-sm border border-border bg-inset px-1.5 text-[12px] text-fg ${focusRing}`}
            >
              <option value="odiserver">ODIServer Project</option>
              {importers.map((imp) => (
                <option key={imp.id} value={imp.id}>
                  {imp.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={
              target.kind === 'project' && format !== 'odiserver'
                ? (importers.find((i) => i.id === format)?.fileExtensions.join(',') ??
                  ACCEPT[target.kind])
                : ACCEPT[target.kind]
            }
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

        {preview && (
          <div
            aria-label="Import preview"
            className="flex flex-col gap-1 rounded-sm border border-border bg-inset px-2.5 py-2"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {mode === 'replace' ? 'Will change (replace)' : 'Will change (merge)'}
            </p>
            {preview.totalChanges === 0 ? (
              <p className="text-[11px] text-muted">
                This file is identical to the current project — nothing will change.
              </p>
            ) : (
              <>
                <DiffLine label="Channels" diff={preview.channels} />
                <DiffLine label="Devices" diff={preview.devices} />
                <DiffLine label="Tags" diff={preview.tags} />
                {mode === 'merge' &&
                  preview.channels.removed.length + preview.devices.removed.length + preview.tags.removed.length >
                    0 && (
                    <p className="text-[11px] text-uncertain">
                      Note: merge mode upserts only — removed entries above stay unless you choose
                      Replace.
                    </p>
                  )}
              </>
            )}
          </div>
        )}

        {target.kind === 'project' && mode === 'replace' && !result && (
          <label className="flex items-center gap-2 rounded-sm border border-bad/40 bg-bad-bg px-2.5 py-2 text-[12px] text-bad">
            <span className="shrink-0">
              Type <span className="font-mono font-semibold">REPLACE</span> to confirm:
            </span>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={replaceConfirm}
              onChange={(e) => setReplaceConfirm(e.target.value)}
              aria-label="Type REPLACE to confirm project replacement"
              className={`h-6 w-28 rounded-sm border border-border bg-inset px-1.5 font-mono text-[12px] text-fg ${focusRing}`}
            />
          </label>
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
        {warnings.length > 0 && (
          <div
            role="alert"
            className="max-h-32 overflow-auto rounded-sm border border-uncertain bg-uncertain-bg px-2.5 py-2"
          >
            <p className="text-[12px] font-semibold text-uncertain">
              ⚠ {warnings.length} importer warning{warnings.length === 1 ? '' : 's'} — review before
              proceeding
            </p>
            <ul className="mt-1 list-inside list-disc text-[11px] text-fg">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-1 flex justify-end gap-2 border-t border-border pt-2.5">
          <button
            type="button"
            onClick={onClose}
            className={`h-7 rounded-sm border border-border bg-inset px-3 text-[12px] hover:bg-hover ${focusRing}`}
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {result ? (
            <button
              type="button"
              onClick={() => {
                setResult('');
                setWarnings([]);
                setFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              className={`h-7 rounded-sm border border-border bg-inset px-3 text-[12px] hover:bg-hover ${focusRing}`}
            >
              Import another
            </button>
          ) : (
            <button
              type="submit"
              disabled={busy || !file || !replaceConfirmed}
              title={!replaceConfirmed ? 'Type REPLACE above to enable a replace import' : undefined}
              className={`h-7 rounded-sm border border-accent bg-accent px-3 text-[12px] font-medium text-accent-fg enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
