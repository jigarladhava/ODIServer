import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProject } from '../lib/project';

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  onRun: () => void;
}

interface CommandPaletteProps {
  commands: PaletteCommand[];
}

const focusRing =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

/**
 * Ctrl+K command palette: runs registered commands and jumps to any tag,
 * device, or channel by name (big projects live here).
 */
export function CommandPalette({ commands }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { project } = useProject();
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery('');
        setActiveIndex(0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  interface Item {
    key: string;
    label: string;
    hint?: string;
    onRun: () => void;
  }

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Item[] = [];
    for (const cmd of commands) {
      if (!q || cmd.label.toLowerCase().includes(q)) {
        out.push({ key: `cmd:${cmd.id}`, label: cmd.label, hint: cmd.hint, onRun: cmd.onRun });
      }
    }
    if (project && q) {
      for (const channel of project.channels) {
        if (channel.name.toLowerCase().includes(q)) {
          out.push({
            key: `channel:${channel.id}`,
            label: channel.name,
            hint: 'Channel',
            onRun: () => navigate({ pathname: '/', search: `?node=channel:${channel.id}` }),
          });
        }
      }
      for (const device of project.devices) {
        if (device.name.toLowerCase().includes(q)) {
          out.push({
            key: `device:${device.id}`,
            label: device.name,
            hint: 'Device',
            onRun: () => navigate({ pathname: '/', search: `?node=device:${device.id}` }),
          });
        }
      }
      let tagMatches = 0;
      for (const tag of project.tags) {
        if (tagMatches >= 20) break;
        if (tag.name.toLowerCase().includes(q) || tag.address.toLowerCase().includes(q)) {
          tagMatches += 1;
          out.push({
            key: `tag:${tag.id}`,
            label: tag.name,
            hint: `Tag · ${tag.address}`,
            onRun: () =>
              navigate({ pathname: '/', search: `?node=device:${tag.deviceId}&row=${tag.id}` }),
          });
        }
      }
    }
    return out.slice(0, 40);
  }, [commands, project, query, navigate]);

  if (!open) return null;

  const run = (item: Item) => {
    setOpen(false);
    item.onRun();
  };

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[28rem] max-w-[90vw] rounded-sm border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-label="Type a command or search tags, devices, channels"
          placeholder="Type a command, or find a tag / device / channel…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && items[activeIndex]) {
              e.preventDefault();
              run(items[activeIndex]);
            }
          }}
          className={`h-9 w-full rounded-t-sm border-b border-border bg-inset px-3 text-[13px] text-fg placeholder:text-muted ${focusRing}`}
        />
        <ul role="listbox" className="max-h-80 overflow-auto py-1">
          {items.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-muted">No matches.</li>
          ) : (
            items.map((item, index) => (
              <li key={item.key} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  onClick={() => run(item)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] ${
                    index === activeIndex ? 'bg-selected text-fg' : 'text-fg'
                  } ${focusRing}`}
                >
                  <span translate="no" className="min-w-0 flex-1 truncate font-mono">
                    {item.label}
                  </span>
                  {item.hint && <span className="shrink-0 text-[10px] text-muted">{item.hint}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="border-t border-border px-3 py-1 text-[10px] text-muted">
          ↑↓ navigate · Enter run · Esc close
        </p>
      </div>
    </div>
  );
}
