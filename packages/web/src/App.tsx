import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { createEntity, downloadDevice, downloadProject, downloadTags, importProject, type ImportResult } from './lib/api-client';
import { useDirtyGuard } from './lib/dirty';
import { useProject } from './lib/project';
import { useToasts } from './lib/toast';
import type { Channel, Device, Project, Tag } from './lib/types';
import { CommandPalette, type PaletteCommand } from './components/CommandPalette';
import { ConfirmDeleteModal, type DeleteTarget } from './components/ConfirmDeleteModal';
import { EntityModal, type CreateTarget } from './components/EntityModal';
import { ImportModal, type ImportTarget } from './components/ImportModal';
import { MenuBar } from './components/MenuBar';
import { Modal } from './components/Modal';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { ConnectivityPage } from './pages/ConnectivityPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { EventLogPage } from './pages/EventLogPage';
import { MqttPage } from './pages/MqttPage';
import { SettingsPage } from './pages/SettingsPage';

/** What the Delete action would target, given the current tree/grid selection. */
function resolveDeleteTarget(
  project: Project | null,
  nodeId: string,
  rowId: string | null,
): DeleteTarget | undefined {
  if (!project) return undefined;
  if (rowId) {
    const tag = project.tags.find((t) => t.id === rowId);
    if (tag) return { kind: 'tag', id: tag.id, name: tag.name, parentId: tag.deviceId };
    const device = project.devices.find((d) => d.id === rowId);
    if (device)
      return { kind: 'device', id: device.id, name: device.name, parentId: device.channelId };
    const channel = project.channels.find((c) => c.id === rowId);
    if (channel) return { kind: 'channel', id: channel.id, name: channel.name };
  }
  if (nodeId.startsWith('device:')) {
    const id = nodeId.slice(7);
    const device = project.devices.find((d) => d.id === id);
    if (device) return { kind: 'device', id, name: device.name, parentId: device.channelId };
  }
  if (nodeId.startsWith('channel:')) {
    const id = nodeId.slice(8);
    const channel = project.channels.find((c) => c.id === id);
    if (channel) return { kind: 'channel', id, name: channel.name };
  }
  return undefined;
}

/** Snapshot of everything a delete removes — the payload for the Undo toast. */
interface DeleteSnapshot {
  channels: Channel[];
  devices: Device[];
  tags: Tag[];
}

function captureDeleteSnapshot(project: Project, target: DeleteTarget): DeleteSnapshot {
  if (target.kind === 'tag') {
    return {
      channels: [],
      devices: [],
      tags: project.tags.filter((t) => t.id === target.id),
    };
  }
  if (target.kind === 'device') {
    return {
      channels: [],
      devices: project.devices.filter((d) => d.id === target.id),
      tags: project.tags.filter((t) => t.deviceId === target.id),
    };
  }
  const devices = project.devices.filter((d) => d.channelId === target.id);
  const deviceIds = new Set(devices.map((d) => d.id));
  return {
    channels: project.channels.filter((c) => c.id === target.id),
    devices,
    tags: project.tags.filter((t) => deviceIds.has(t.deviceId)),
  };
}

export default function App() {
  const { project, refresh } = useProject();
  const { push } = useToasts();
  const { confirmDiscard } = useDirtyGuard();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteSnapshot, setDeleteSnapshot] = useState<DeleteSnapshot | null>(null);
  const [importTarget, setImportTarget] = useState<ImportTarget | null>(null);
  const [confirmNewProject, setConfirmNewProject] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [actionError, setActionError] = useState<string>('');

  const nodeId = searchParams.get('node') ?? 'connectivity';
  const rowId = searchParams.get('row');

  // Context for the New Device / New Tag buttons: the selected channel/device.
  const newDeviceParentId = nodeId.startsWith('channel:')
    ? nodeId.slice(8)
    : nodeId.startsWith('device:')
      ? project?.devices.find((d) => d.id === nodeId.slice(7))?.channelId
      : undefined;
  const newTagParentId = nodeId.startsWith('device:') ? nodeId.slice(7) : undefined;

  // Selection context for device/tag import-export.
  const selectedChannelId = newDeviceParentId;
  const selectedDeviceId = newTagParentId;
  const selectedChannelName = selectedChannelId
    ? project?.channels.find((c) => c.id === selectedChannelId)?.name
    : undefined;
  const selectedDeviceName = selectedDeviceId
    ? project?.devices.find((d) => d.id === selectedDeviceId)?.name
    : undefined;

  const currentDeleteTarget = resolveDeleteTarget(project, nodeId, rowId);

  const openDelete = () => {
    if (!currentDeleteTarget || !project) return;
    // Capture the subtree before the modal runs so the Undo toast can restore it.
    setDeleteSnapshot(captureDeleteSnapshot(project, currentDeleteTarget));
    setDeleteTarget(currentDeleteTarget);
  };

  // Delete key deletes the current tree/grid selection (with confirmation).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
        return;
      }
      if (currentDeleteTarget) {
        e.preventDefault();
        openDelete();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const runDownload = (download: () => Promise<void>) => {
    download().catch((e) => setActionError(e instanceof Error ? e.message : String(e)));
  };

  const onNewProjectConfirmed = () => {
    setConfirmNewProject(false);
    importProject({ channels: [], devices: [], tags: [] }, 'replace')
      .then(() => {
        setSearchParams({});
        push({ tone: 'success', message: 'New empty project created.' });
        return refresh();
      })
      .catch((e) => setActionError(e instanceof Error ? e.message : String(e)));
  };

  const onCreated = (target: CreateTarget, id: string) => {
    setCreateTarget(null);
    void refresh();
    push({ tone: 'success', message: `${target.kind} created.` });
    // Select the newly created entity in the tree / grid.
    if (target.kind === 'channel') setSearchParams({ node: `channel:${id}` });
    else if (target.kind === 'device') setSearchParams({ node: `device:${id}` });
    else if (target.parentId) setSearchParams({ node: `device:${target.parentId}`, row: id });
  };

  const undoDelete = (target: DeleteTarget, snapshot: DeleteSnapshot) => {
    (async () => {
      try {
        for (const channel of snapshot.channels) await createEntity('channel', channel);
        for (const device of snapshot.devices) await createEntity('device', device);
        for (const tag of snapshot.tags) await createEntity('tag', tag);
        await refresh();
        push({ tone: 'success', message: `Restored ${target.kind} "${target.name}".` });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  const onDeleted = (target: DeleteTarget) => {
    setDeleteTarget(null);
    void refresh();
    const snapshot = deleteSnapshot;
    setDeleteSnapshot(null);
    const cascaded =
      snapshot && snapshot.devices.length + snapshot.tags.length > 0
        ? ` (${snapshot.devices.length} device(s), ${snapshot.tags.length} tag(s))`
        : '';
    push({
      tone: 'info',
      message: `Deleted ${target.kind} "${target.name}"${cascaded}.`,
      ...(snapshot && snapshot.channels.length + snapshot.devices.length + snapshot.tags.length > 0
        ? { action: { label: 'Undo', onClick: () => undoDelete(target, snapshot) } }
        : {}),
      durationMs: 10_000,
    });
    // Move the selection to the deleted entity's parent (or the root).
    if (target.kind === 'tag' && target.parentId) {
      setSearchParams({ node: `device:${target.parentId}` });
    } else if (target.kind === 'device' && target.parentId) {
      setSearchParams({ node: `channel:${target.parentId}` });
    } else {
      setSearchParams({});
    }
  };

  const onImported = (target: ImportTarget, result: ImportResult) => {
    const parts: string[] = [];
    if (result.imported.channels !== undefined) parts.push(`${result.imported.channels} channel(s)`);
    if (result.imported.devices !== undefined) parts.push(`${result.imported.devices} device(s)`);
    if (result.imported.tags !== undefined) parts.push(`${result.imported.tags} tag(s)`);
    const warningCount = result.warnings?.length ?? 0;
    push({
      tone: warningCount > 0 ? 'info' : 'success',
      message: `Import complete: ${parts.join(', ') || 'nothing to import'}${
        warningCount > 0 ? `, ${warningCount} warning(s)` : ''
      }.`,
    });
    void refresh().then(() => {
      if (target.kind === 'project') {
        setSearchParams({});
      } else if (target.kind === 'device' && result.device) {
        setSearchParams({ node: `device:${result.device.id}` });
      }
    });
  };

  const paletteCommands: PaletteCommand[] = [
    { id: 'new-channel', label: 'New Channel', onRun: () => setCreateTarget({ kind: 'channel' }) },
    ...(newDeviceParentId
      ? [{ id: 'new-device', label: 'New Device', onRun: () => setCreateTarget({ kind: 'device', parentId: newDeviceParentId }) }]
      : []),
    ...(newTagParentId
      ? [{ id: 'new-tag', label: 'New Tag', onRun: () => setCreateTarget({ kind: 'tag', parentId: newTagParentId }) }]
      : []),
    ...(currentDeleteTarget
      ? [{ id: 'delete', label: `Delete ${currentDeleteTarget.kind} "${currentDeleteTarget.name}"`, onRun: openDelete }]
      : []),
    { id: 'open-project', label: 'Open Project (import)', onRun: () => setImportTarget({ kind: 'project' }) },
    { id: 'save-project', label: 'Save Project (export)', onRun: () => runDownload(downloadProject) },
    ...(selectedDeviceId
      ? [{ id: 'export-tags', label: 'Export Tags (CSV)', onRun: () => runDownload(() => downloadTags(selectedDeviceId, 'csv')) }]
      : []),
    { id: 'go-connectivity', label: 'Go to Connectivity', onRun: () => navigate('/') },
    { id: 'go-mqtt', label: 'Go to MQTT', onRun: () => navigate('/mqtt') },
    { id: 'go-events', label: 'Go to Event Log', onRun: () => navigate('/events') },
    { id: 'go-diagnostics', label: 'Go to Diagnostics', onRun: () => navigate('/diagnostics') },
    { id: 'go-settings', label: 'Go to Settings', onRun: () => navigate('/settings') },
  ];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-fg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-accent focus:px-2 focus:py-1 focus:text-accent-fg"
      >
        Skip to main content
      </a>
      <MenuBar
        onNewChannel={() => setCreateTarget({ kind: 'channel' })}
        onNewDevice={
          newDeviceParentId
            ? () => setCreateTarget({ kind: 'device', parentId: newDeviceParentId })
            : undefined
        }
        onNewTag={
          newTagParentId
            ? () => setCreateTarget({ kind: 'tag', parentId: newTagParentId })
            : undefined
        }
        onDelete={currentDeleteTarget ? openDelete : undefined}
        onNewProject={() => setConfirmNewProject(true)}
        onOpenProject={() => setImportTarget({ kind: 'project' })}
        onSaveProject={() => runDownload(downloadProject)}
        onImportDevice={
          selectedChannelId
            ? () =>
                setImportTarget({ kind: 'device', parentId: selectedChannelId, parentName: selectedChannelName })
            : undefined
        }
        onExportDevice={
          selectedDeviceId ? () => runDownload(() => downloadDevice(selectedDeviceId)) : undefined
        }
        onImportTags={
          selectedDeviceId
            ? () => setImportTarget({ kind: 'tags', parentId: selectedDeviceId, parentName: selectedDeviceName })
            : undefined
        }
        onExportTags={
          selectedDeviceId ? () => runDownload(() => downloadTags(selectedDeviceId, 'csv')) : undefined
        }
        onAbout={() => setShowAbout(true)}
      />
      <Toolbar
        onNewChannel={() => setCreateTarget({ kind: 'channel' })}
        onNewDevice={
          newDeviceParentId
            ? () => setCreateTarget({ kind: 'device', parentId: newDeviceParentId })
            : undefined
        }
        onNewTag={
          newTagParentId
            ? () => setCreateTarget({ kind: 'tag', parentId: newTagParentId })
            : undefined
        }
        onDelete={currentDeleteTarget ? openDelete : undefined}
        deleteLabel={
          currentDeleteTarget
            ? `Delete ${currentDeleteTarget.kind} "${currentDeleteTarget.name}"`
            : undefined
        }
      />
      <main id="main-content" className="flex min-h-0 flex-1 flex-col">
        <Routes>
          <Route path="/" element={<ConnectivityPage />} />
          <Route path="/mqtt" element={<MqttPage />} />
          <Route path="/events" element={<EventLogPage />} />
          <Route path="/diagnostics" element={<DiagnosticsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <StatusBar />
      <CommandPalette
        commands={paletteCommands.map((cmd) =>
          cmd.id.startsWith('go-')
            ? { ...cmd, onRun: () => { if (confirmDiscard()) cmd.onRun(); } }
            : cmd,
        )}
      />
      <EntityModal
        target={createTarget}
        onClose={() => setCreateTarget(null)}
        onCreated={onCreated}
      />
      <ConfirmDeleteModal
        target={deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteSnapshot(null);
        }}
        onDeleted={onDeleted}
      />
      <Modal
        open={confirmNewProject}
        onClose={() => setConfirmNewProject(false)}
        title="New Project"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmNewProject(false)}
              className="h-7 rounded-sm border border-border bg-inset px-3 text-[12px] hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onNewProjectConfirmed}
              className="h-7 rounded-sm border border-bad bg-bad px-3 text-[12px] font-medium text-white hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            >
              Create Empty Project
            </button>
          </>
        }
      >
        <p className="text-[12px] text-fg">
          This removes all existing channels, devices, and tags and starts with an empty project.
          This action cannot be undone.
        </p>
        <p className="mt-2 text-[12px] text-muted">
          Tip: use Project → Save Project first to keep a backup copy.
        </p>
      </Modal>
      <ImportModal
        target={importTarget}
        onClose={() => setImportTarget(null)}
        onImported={onImported}
      />
      <Modal
        open={showAbout}
        onClose={() => setShowAbout(false)}
        title="About ODIServer"
        footer={
          <button
            type="button"
            onClick={() => setShowAbout(false)}
            className="h-7 rounded-sm border border-border bg-inset px-3 text-[12px] hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            Close
          </button>
        }
      >
        <div className="text-[12px] text-fg">
          <p className="text-[14px] font-semibold">ODIServer</p>
          <p className="mt-0.5 text-muted">Open Data &amp; Interface Server — v0.2.0</p>
          <p className="mt-3">
            Open-source, cross-platform industrial connectivity server with device drivers,
            a live tag engine, and northbound OPC UA and MQTT interfaces.
          </p>
          <div className="mt-3 border-t border-border pt-2">
            <p>
              <span className="text-muted">Developer:</span> Jigar Ladhava
            </p>
            <p>
              <span className="text-muted">License:</span> Apache-2.0
            </p>
          </div>
        </div>
      </Modal>
      <Modal
        open={actionError !== ''}
        onClose={() => setActionError('')}
        title="Operation Failed"
        footer={
          <button
            type="button"
            onClick={() => setActionError('')}
            className="h-7 rounded-sm border border-border bg-inset px-3 text-[12px] hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
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
