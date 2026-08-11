/**
 * REST + WebSocket client for the ODIServer backend (@odiserver/server).
 *
 * All data access in the UI goes through this module. When the console is
 * served from the backend (packages/web/dist) these are same-origin calls;
 * in `vite dev` the dev-server proxies /api and /ws to localhost:8080.
 */
import type {
  Device,
  EntityKind,
  Project,
  ServerStatus,
  ValueChange,
  ValueMap,
} from './types';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === 'object' && 'error' in body) {
        const errorText = (body as { error: unknown }).error;
        if (typeof errorText === 'string' && errorText.length > 0) message = errorText;
      }
    } catch {
      // keep the status-line message
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const plural = (kind: EntityKind) => `${kind}s`;

export function getProject(): Promise<Project> {
  return request<Project>('/project');
}

export function getStatus(): Promise<ServerStatus> {
  return request<ServerStatus>('/status');
}

export function getValues(): Promise<ValueMap> {
  return request<ValueMap>('/values');
}

export function createEntity<T>(kind: EntityKind, config: unknown): Promise<T> {
  return request<T>(`/${plural(kind)}`, { method: 'POST', body: JSON.stringify(config) });
}

export function updateEntity<T>(kind: EntityKind, id: string, config: unknown): Promise<T> {
  return request<T>(`/${plural(kind)}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export function deleteEntity(kind: EntityKind, id: string): Promise<void> {
  return request<void>(`/${plural(kind)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function writeValue(tagId: string, value: number | boolean | string): Promise<void> {
  return request<void>(`/values/${encodeURIComponent(tagId)}/write`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  });
}

// ---------------------------------------------------------------------------
// Import / export (project open/save, device bundles, tag CSV)
// ---------------------------------------------------------------------------

export interface ImportResult {
  mode?: string;
  device?: Device;
  imported: { channels?: number; devices?: number; tags?: number };
}

export function importProject(project: unknown, mode: 'replace' | 'merge'): Promise<ImportResult> {
  return request<ImportResult>(`/project/import?mode=${mode}`, {
    method: 'POST',
    body: JSON.stringify(project),
  });
}

export function importDevice(bundle: unknown, channelId?: string): Promise<ImportResult> {
  const query = channelId ? `?channel=${encodeURIComponent(channelId)}` : '';
  return request<ImportResult>(`/devices/import${query}`, {
    method: 'POST',
    body: JSON.stringify(bundle),
  });
}

/** Import tags into a device. CSV text is sent as text/csv; arrays as JSON. */
export function importTags(deviceId: string, payload: string | unknown[]): Promise<ImportResult> {
  const isCsv = typeof payload === 'string';
  return request<ImportResult>(`/tags/import?device=${encodeURIComponent(deviceId)}`, {
    method: 'POST',
    headers: { 'Content-Type': isCsv ? 'text/csv' : 'application/json' },
    body: isCsv ? payload : JSON.stringify(payload),
  });
}

/**
 * Fetch a download endpoint and save it as a file, honoring the server's
 * Content-Disposition filename.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === 'object' && 'error' in body) {
        const errorText = (body as { error: unknown }).error;
        if (typeof errorText === 'string' && errorText.length > 0) message = errorText;
      }
    } catch {
      // keep the status-line message
    }
    throw new ApiError(message, res.status);
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ?? fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadProject(): Promise<void> {
  return downloadFile('/project/export', 'odiserver-project.json');
}

export function downloadDevice(deviceId: string): Promise<void> {
  return downloadFile(`/devices/${encodeURIComponent(deviceId)}/export`, 'device.json');
}

export function downloadTags(deviceId: string, format: 'csv' | 'json' = 'csv'): Promise<void> {
  return downloadFile(
    `/tags/export?device=${encodeURIComponent(deviceId)}&format=${format}`,
    format === 'csv' ? 'tags.csv' : 'tags.json',
  );
}

export interface ValuesHandlers {
  onSnapshot?: (data: ValueMap) => void;
  onChange?: (change: ValueChange) => void;
  onStateChange?: (connected: boolean) => void;
}

/**
 * Subscribe to live tag values over /ws. Reconnects with exponential backoff
 * (1s → 2s → 4s … capped at 15s) until the returned unsubscribe is called.
 */
export function subscribeValues(handlers: ValuesHandlers): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: number | undefined;

  const connect = () => {
    if (closed) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    ws.onopen = () => {
      attempt = 0;
      handlers.onStateChange?.(true);
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as
          | { type: 'snapshot'; data: ValueMap }
          | { type: 'change'; data: ValueChange };
        if (msg.type === 'snapshot') handlers.onSnapshot?.(msg.data);
        else if (msg.type === 'change') handlers.onChange?.(msg.data);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      handlers.onStateChange?.(false);
      if (closed) return;
      const delayMs = Math.min(15_000, 1000 * 2 ** attempt);
      attempt += 1;
      timer = window.setTimeout(connect, delayMs);
    };
  };

  connect();

  return () => {
    closed = true;
    window.clearTimeout(timer);
    ws?.close();
  };
}
