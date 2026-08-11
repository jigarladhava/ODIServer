export interface PropertyEntry {
  name: string;
  value: string;
  mono?: boolean;
}

interface PropertyInspectorProps {
  title: string;
  entries: PropertyEntry[];
}

export function PropertyInspector({ title, entries }: PropertyInspectorProps) {
  return (
    <section aria-label={title} className="flex h-full flex-col bg-panel">
      <h2 className="border-b border-border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      <dl className="min-h-0 flex-1 overflow-auto">
        {entries.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-muted">Select a row to inspect its properties.</p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.name}
              className="grid grid-cols-[160px_1fr] border-b border-border text-[12px]"
            >
              <dt className="truncate border-r border-border px-2 py-1 text-muted">{entry.name}</dt>
              <dd
                translate={entry.mono ? 'no' : undefined}
                className={`truncate px-2 py-1 ${entry.mono ? 'font-mono tabular-nums' : ''}`}
              >
                {entry.value}
              </dd>
            </div>
          ))
        )}
      </dl>
    </section>
  );
}
