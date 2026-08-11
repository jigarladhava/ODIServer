import { SearchIcon } from './icons';

interface BreadcrumbBarProps {
  segments: string[];
  filter: string;
  onFilterChange: (value: string) => void;
}

export function BreadcrumbBar({ segments, filter, onFilterChange }: BreadcrumbBarProps) {
  return (
    <div className="flex h-8 items-center gap-2 border-b border-border bg-panel px-3">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center text-[12px]">
        {segments.map((segment, i) => (
          <span key={i} className="flex min-w-0 items-center">
            {i > 0 && (
              <span aria-hidden="true" className="mx-1.5 text-muted">
                /
              </span>
            )}
            <span
              translate="no"
              className={`truncate ${i === segments.length - 1 ? 'font-medium text-fg' : 'text-muted'}`}
            >
              {segment}
            </span>
          </span>
        ))}
      </nav>
      <div className="relative ml-auto">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted">
          <SearchIcon />
        </span>
        <input
          type="search"
          aria-label="Filter tree"
          placeholder="Filter…"
          autoComplete="off"
          spellCheck={false}
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          className="h-6 w-48 rounded-sm border border-border bg-inset pl-7 pr-2 text-[12px] text-fg placeholder:text-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        />
      </div>
    </div>
  );
}
