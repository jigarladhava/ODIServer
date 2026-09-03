import { EventLogView } from '../components/EventLogView';

export function EventLogPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 items-center border-b border-border bg-panel px-3">
        <h1 className="text-[12px] font-semibold">Event Log</h1>
      </div>
      <div className="min-h-0 flex-1 bg-inset">
        <EventLogView />
      </div>
    </div>
  );
}
