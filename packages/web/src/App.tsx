import { useState } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { downloadDevice, downloadProject, downloadTags, importProject, type ImportResult } from './lib/api-client';
import { useProject } from './lib/project';
import type { Project } from './lib/types';
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

export default function App() {
  const { project, refresh } = useProject();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
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

  const runDownload = (download: () => Promise<void>) => {
    download().catch((e) => setActionError(e instanceof Error ? e.message : String(e)));
  };

  const onNewProjectConfirmed = () => {
    setConfirmNewProject(false);
    importProject({ channels: [], devices: [], tags: [] }, 'replace')
      .then(() => {
        setSearchParams({});
        return refresh();
      })
      .catch((e) => setActionError(e instanceof Error ? e.message : String(e)));
  };

  const onCreated = (target: CreateTarget, id: string) => {
    setCreateTarget(null);
    void refresh();
    // Select the newly created entity in the tree / grid.
    if (target.kind === 'channel') setSearchParams({ node: `channel:${id}` });
    else if (target.kind === 'device') setSearchParams({ node: `device:${id}` });
    else if (target.parentId) setSearchParams({ node: `device:${target.parentId}`, row: id });
  };

  const onDeleted = (target: DeleteTarget) => {
    setDeleteTarget(null);
    void refresh();
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
    void refresh().then(() => {
      if (target.kind === 'project') {
        setSearchParams({});
      } else if (target.kind === 'device' && result.device) {
        setSearchParams({ node: `device:${result.device.id}` });
      }
    });
  };

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
        onDelete={currentDeleteTarget ? () => setDeleteTarget(currentDeleteTarget) : undefined}
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
        onDelete={currentDeleteTarget ? () => setDeleteTarget(currentDeleteTarget) : undefined}
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
      <EntityModal
        target={createTarget}
        onClose={() => setCreateTarget(null)}
        onCreated={onCreated}
      />
      <ConfirmDeleteModal
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
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
          <p className="mt-0.5 text-muted">Open Data &amp; Interface Server — v0.1.0</p>
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
