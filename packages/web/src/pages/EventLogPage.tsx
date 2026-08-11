export function EventLogPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 items-center border-b border-border bg-panel px-3">
        <h1 className="text-[12px] font-semibold">Event Log</h1>
      </div>
      <div className="flex flex-1 items-center justify-center bg-inset p-6">
        <p className="max-w-md text-center text-[12px] text-muted">
          No event log backend yet. This page will show timestamped server events once the runtime
          exposes an event log endpoint.
        </p>
      </div>
    </div>
  );
}
