import type { ReactNode } from 'react';

interface Tab {
  id: string;
  label: string;
}


interface TabsProps {
  tabs: Tab[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  /** Optional content pinned to the right end of the tab strip. */
  trailing?: ReactNode;
}

export function Tabs({ tabs, activeId, onChange, ariaLabel, trailing }: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex h-8 items-end gap-0 border-b border-border bg-panel px-2"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`h-7 border border-b-0 px-3 text-[12px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent ${
              active
                ? 'rounded-t-sm border-border bg-inset font-medium text-fg'
                : 'border-transparent text-muted hover:bg-hover hover:text-fg'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
      {trailing && <div className="mb-1 ml-auto flex items-center gap-1">{trailing}</div>}
    </div>
  );
}
