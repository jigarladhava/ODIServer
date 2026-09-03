import { describe, expect, it, vi } from "vitest";
import { EventLog, type ServerEvent } from "../src/event-log.js";

describe("EventLog", () => {
  it("appends events with monotonic ids and timestamps", () => {
    const log = new EventLog();
    const a = log.info("server", "started");
    const b = log.error("mqtt", "broker down");
    expect(b.id).toBeGreaterThan(a.id);
    expect(a.timestamp).toBeGreaterThan(0);
    expect(a).toMatchObject({ severity: "info", source: "server", message: "started" });
  });

  it("emits each event to live subscribers", () => {
    const log = new EventLog();
    const seen: ServerEvent[] = [];
    log.on("event", (e) => seen.push(e));
    log.warning("device", "tag quality bad");
    expect(seen).toHaveLength(1);
    expect(seen[0].message).toBe("tag quality bad");
  });

  it("bounds the buffer to its capacity", () => {
    const log = new EventLog(10);
    for (let i = 0; i < 25; i++) log.info("test", `event ${i}`);
    const events = log.list();
    expect(events).toHaveLength(10);
    expect(events[0].message).toBe("event 15");
    expect(events[9].message).toBe("event 24");
  });

  it("filters by since, severity, and source", () => {
    const log = new EventLog();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1000);
      log.info("server", "a");
      vi.setSystemTime(2000);
      log.warning("mqtt", "b");
      vi.setSystemTime(3000);
      log.error("mqtt", "c");
    } finally {
      vi.useRealTimers();
    }
    expect(log.list({ since: 2000 }).map((e) => e.message)).toEqual(["b", "c"]);
    expect(log.list({ severity: "error" }).map((e) => e.message)).toEqual(["c"]);
    expect(log.list({ source: "mqtt" }).map((e) => e.message)).toEqual(["b", "c"]);
  });

  it("returns the newest events when limited", () => {
    const log = new EventLog();
    for (let i = 0; i < 5; i++) log.info("test", `event ${i}`);
    expect(log.list({ limit: 2 }).map((e) => e.message)).toEqual(["event 3", "event 4"]);
  });
});
