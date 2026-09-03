import { EventEmitter } from "node:events";

export type EventSeverity = "info" | "warning" | "error";

export const EVENT_SEVERITIES: readonly EventSeverity[] = ["info", "warning", "error"];

export interface ServerEvent {
  /** Monotonic id assigned by the log (larger = newer). */
  id: number;
  /** Unix epoch milliseconds. */
  timestamp: number;
  severity: EventSeverity;
  /** Originating subsystem, e.g. "server", "config", "device", "mqtt", "opcua". */
  source: string;
  message: string;
}

export interface NewServerEvent {
  severity: EventSeverity;
  source: string;
  message: string;
}

export interface EventQuery {
  /** Max events to return (newest ones). Default: all buffered. */
  limit?: number;
  /** Only events at/after this epoch-ms timestamp. */
  since?: number;
  severity?: EventSeverity;
  source?: string;
}

export interface EventLogEvents {
  /** Emitted for every appended event (live streaming). */
  event: (event: ServerEvent) => void;
}

export declare interface EventLog {
  on<E extends keyof EventLogEvents>(event: E, listener: EventLogEvents[E]): this;
  emit<E extends keyof EventLogEvents>(event: E, ...args: Parameters<EventLogEvents[E]>): boolean;
}

/**
 * In-memory ring buffer of timestamped server events. Subsystems append
 * events; the REST API and WebSocket stream them to the console. Capacity
 * is bounded so a chatty subsystem cannot grow memory without limit.
 */
export class EventLog extends EventEmitter {
  private buffer: ServerEvent[] = [];
  private nextId = 1;
  private readonly capacity: number;

  constructor(capacity = 2000) {
    super();
    this.capacity = Math.max(1, capacity);
  }

  /** Append an event and broadcast it to live subscribers. */
  add(entry: NewServerEvent): ServerEvent {
    const event: ServerEvent = {
      id: this.nextId++,
      timestamp: Date.now(),
      severity: entry.severity,
      source: entry.source,
      message: entry.message,
    };
    this.buffer.push(event);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
    this.emit("event", event);
    return event;
  }

  info(source: string, message: string): ServerEvent {
    return this.add({ severity: "info", source, message });
  }

  warning(source: string, message: string): ServerEvent {
    return this.add({ severity: "warning", source, message });
  }

  error(source: string, message: string): ServerEvent {
    return this.add({ severity: "error", source, message });
  }

  /** Query buffered events in chronological order (oldest first). */
  list(query: EventQuery = {}): ServerEvent[] {
    let out = this.buffer;
    if (query.since !== undefined) {
      const since = query.since;
      out = out.filter((e) => e.timestamp >= since);
    }
    if (query.severity !== undefined) {
      out = out.filter((e) => e.severity === query.severity);
    }
    if (query.source !== undefined) {
      out = out.filter((e) => e.source === query.source);
    }
    if (query.limit !== undefined && out.length > query.limit) {
      out = out.slice(out.length - query.limit);
    }
    return [...out];
  }
}
