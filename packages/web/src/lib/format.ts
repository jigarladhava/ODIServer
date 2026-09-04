const timestampFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatTimestamp(epochMs: number): string {
  return timestampFormat.format(new Date(epochMs));
}

/** Compact relative time ("just now", "45s ago", "2m ago", "3h ago", "2d ago"). */
export function formatRelativeTime(epochMs: number, now: number = Date.now()): string {
  const deltaSec = Math.round((now - epochMs) / 1000);
  if (deltaSec < 5) return 'just now';
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const minutes = Math.floor(deltaSec / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatUptime(uptimeMs: number): string {
  const seconds = Math.max(0, Math.floor(uptimeMs / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return `${hours}h ${minutes}m ${secs}s`;
}

export function formatValue(value: number | boolean | string | null): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return String(value);
}
