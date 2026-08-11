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
