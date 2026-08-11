import type { ReactElement } from 'react';

const iconClass = 'h-3 w-3 shrink-0';

export function ConnectivityIcon(): ReactElement {
  return (
    <svg className={iconClass} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="2" width="12" height="4" rx="1" />
      <rect x="2" y="10" width="12" height="4" rx="1" />
      <path d="M8 6v4" />
    </svg>
  );
}

export function ChannelIcon(): ReactElement {
  return (
    <svg className={iconClass} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M9.5 1.5 4.5 9h2.8l-1 5.5L11.5 7H8.6l.9-5.5z" />
    </svg>
  );
}

export function DeviceIcon(): ReactElement {
  return (
    <svg className={iconClass} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="1" />
      <rect x="6" y="6" width="4" height="4" />
      <path d="M5.5 1v2M10.5 1v2M5.5 13v2M10.5 13v2" />
    </svg>
  );
}

export function GroupIcon(): ReactElement {
  return (
    <svg className={iconClass} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.8 2h4.6A1.5 1.5 0 0 1 14 6.5v5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7z" />
    </svg>
  );
}

export function EventLogIcon(): ReactElement {
  return (
    <svg className={iconClass} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M3 4h10M3 8h10M3 12h6" />
    </svg>
  );
}

export function PlusIcon(): ReactElement {
  return (
    <svg className={iconClass} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function SaveIcon(): ReactElement {
  return (
    <svg className={iconClass} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M3 2h8l2 2v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
      <path d="M5 2v4h6V2M5 14v-5h6v5" />
    </svg>
  );
}

export function UndoIcon(): ReactElement {
  return (
    <svg className={iconClass} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M3 6h7a3.5 3.5 0 0 1 0 7H6" />
      <path d="M6 3 3 6l3 3" />
    </svg>
  );
}

export function SearchIcon(): ReactElement {
  return (
    <svg className={iconClass} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </svg>
  );
}

export function SettingsIcon(): ReactElement {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2 4.5h12M2 8h12M2 11.5h12" />
      <circle cx="6" cy="4.5" r="1.6" fill="var(--bg-panel)" />
      <circle cx="10.5" cy="8" r="1.6" fill="var(--bg-panel)" />
      <circle cx="4.5" cy="11.5" r="1.6" fill="var(--bg-panel)" />
    </svg>
  );
}

export function TrashIcon(): ReactElement {
  return (
    <svg className={iconClass} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2.5 4h11M6 4V2.5h4V4M3.5 4l.8 9.5a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9L12.5 4" />
      <path d="M6.5 7v4.5M9.5 7v4.5" />
    </svg>
  );
}

export function SunIcon(): ReactElement {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2 3.4 12.6" />
    </svg>
  );
}

export function MoonIcon(): ReactElement {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />
    </svg>
  );
}
