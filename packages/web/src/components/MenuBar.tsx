import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '../lib/theme';
import { MoonIcon, SettingsIcon, SunIcon } from './icons';

interface MenuEntry {
  label: string;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
}

interface Menu {
  label: string;
  entries: (MenuEntry | 'separator')[];
}

interface MenuBarProps {
  onNewChannel: () => void;
  onNewDevice?: () => void;
  onNewTag?: () => void;
  onDelete?: () => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onImportDevice?: () => void;
  onExportDevice?: () => void;
  onImportTags?: () => void;
  onExportTags?: () => void;
}

const focusRing =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

export function MenuBar({
  onNewChannel,
  onNewDevice,
  onNewTag,
  onDelete,
  onNewProject,
  onOpenProject,
  onSaveProject,
  onImportDevice,
  onExportDevice,
  onImportTags,
  onExportTags,
}: MenuBarProps) {
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openMenu === null) return;
    const onPointerDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  const menus: Menu[] = [
    {
      label: 'Project',
      entries: [
        { label: 'New Project…', onClick: onNewProject },
        { label: 'Open Project…', onClick: onOpenProject },
        { label: 'Save Project', onClick: onSaveProject },
        'separator',
        { label: 'Settings', to: '/settings' },
      ],
    },
    {
      label: 'Connectivity',
      entries: [
        { label: 'New Channel…', onClick: onNewChannel },
        { label: 'New Device…', onClick: onNewDevice, disabled: !onNewDevice },
        { label: 'New Tag…', onClick: onNewTag, disabled: !onNewTag },
        'separator',
        { label: 'Import Device…', onClick: onImportDevice, disabled: !onImportDevice },
        { label: 'Export Device', onClick: onExportDevice, disabled: !onExportDevice },
        'separator',
        { label: 'Import Tags…', onClick: onImportTags, disabled: !onImportTags },
        { label: 'Export Tags (CSV)', onClick: onExportTags, disabled: !onExportTags },
        'separator',
        { label: 'Delete Selected', onClick: onDelete, disabled: !onDelete },
      ],
    },
    {
      label: 'View',
      entries: [
        { label: 'Connectivity', to: '/' },
        { label: 'Event Log', to: '/events' },
        { label: 'Diagnostics', to: '/diagnostics' },
      ],
    },
    {
      label: 'Tools',
      entries: [
        { label: 'OPC UA Configuration…', disabled: true },
        { label: 'Options…', to: '/settings' },
      ],
    },
    {
      label: 'Help',
      entries: [
        { label: 'Documentation', disabled: true },
        { label: 'About ODIServer', onClick: () => navigate('/diagnostics') },
      ],
    },
  ];

  return (
    <div
      ref={barRef}
      className="flex h-8 items-stretch border-b border-border bg-panel px-1 select-none"
    >
      <span className="flex items-center px-2 text-[12px] font-semibold tracking-wide text-muted">
        ODIServer
      </span>
      <nav aria-label="Main menu" className="flex items-stretch">
        {menus.map((menu) => (
          <div key={menu.label} className="relative flex items-stretch">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === menu.label}
              onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
              onMouseEnter={() => {
                if (openMenu !== null) setOpenMenu(menu.label);
              }}
              className={`px-2.5 text-[12px] hover:bg-hover ${focusRing} ${
                openMenu === menu.label ? 'bg-hover' : ''
              }`}
            >
              {menu.label}
            </button>
            {openMenu === menu.label && (
              <div
                role="menu"
                aria-label={menu.label}
                className="absolute left-0 top-full z-40 min-w-44 border border-border bg-inset py-0.5"
              >
                {menu.entries.map((entry, i) =>
                  entry === 'separator' ? (
                    <div key={i} role="separator" className="my-0.5 border-t border-border" />
                  ) : entry.to ? (
                    <Link
                      key={entry.label}
                      role="menuitem"
                      to={entry.to}
                      onClick={() => setOpenMenu(null)}
                      className={`block px-3 py-1 text-[12px] hover:bg-selected ${focusRing}`}
                    >
                      {entry.label}
                    </Link>
                  ) : (
                    <button
                      key={entry.label}
                      type="button"
                      role="menuitem"
                      disabled={entry.disabled}
                      onClick={() => {
                        setOpenMenu(null);
                        entry.onClick?.();
                      }}
                      className={`block w-full px-3 py-1 text-left text-[12px] enabled:hover:bg-selected disabled:cursor-not-allowed disabled:text-muted ${focusRing}`}
                    >
                      {entry.label}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-0.5 pr-1">
        <Link
          to="/settings"
          aria-label="Settings"
          className={`flex h-6 w-6 items-center justify-center rounded-sm hover:bg-hover ${focusRing}`}
        >
          <SettingsIcon />
        </Link>
        <button
          type="button"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={toggle}
          className={`flex h-6 w-6 items-center justify-center rounded-sm hover:bg-hover ${focusRing}`}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </div>
  );
}
