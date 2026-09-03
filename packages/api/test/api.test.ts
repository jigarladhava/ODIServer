import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ConfigStore, EventLog, TagEngine } from "@odiserver/core";
import { createApiApp } from "../src/index.js";

let server: Server;
let base: string;
let store: ConfigStore;
let engine: TagEngine;
let events: EventLog;

beforeAll(async () => {
  store = new ConfigStore(":memory:");
  engine = new TagEngine();
  events = new EventLog();
  const app = createApiApp({ store, engine, startedAt: Date.now(), events });
  server = createServer(app);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((res) => server.close(res));
  store.close();
});

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("ODIServer REST API", () => {
  it("creates and reads back channel/device/tag config", async () => {
    const ch = await post("/api/channels", { id: "ch1", name: "C1", driver: "modbus-tcp" });
    expect(ch.status).toBe(201);

    const dev = await post("/api/devices", { id: "d1", channelId: "ch1", name: "D1", settings: { host: "127.0.0.1" } });
    expect(dev.status).toBe(201);

    const tag = await post("/api/tags", { id: "t1", deviceId: "d1", name: "T1", address: "40001", dataType: "uint16" });
    expect(tag.status).toBe(201);

    const project = (await (await fetch(`${base}/api/project`)).json()) as {
      channels: unknown[];
      devices: unknown[];
      tags: { id: string; scanRateMs: number }[];
    };
    expect(project.channels).toHaveLength(1);
    expect(project.devices).toHaveLength(1);
    expect(project.tags[0]).toMatchObject({ id: "t1", scanRateMs: 1000 });
  });

  it("rejects invalid config with 400 and unknown lookups with 404", async () => {
    const bad = await post("/api/devices", { id: "dx", channelId: "missing", name: "X" });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${base}/api/tags/nope`);
    expect(missing.status).toBe(404);
  });

  it("exposes tag values and accepts write requests", async () => {
    engine.load(store.listTags());
    engine.updateRaw("t1", 42);

    const value = (await (await fetch(`${base}/api/values/t1`)).json()) as { value: number; quality: string };
    expect(value).toMatchObject({ value: 42, quality: "good" });

    const writes: unknown[] = [];
    engine.on("write", (w) => writes.push(w));
    const write = await post("/api/values/t1/write", { value: 7 });
    expect(write.status).toBe(202);
    expect(writes).toEqual([{ tagId: "t1", value: 7 }]);
  });

  it("reports status counts", async () => {
    const status = (await (await fetch(`${base}/api/status`)).json()) as {
      status: string;
      counts: { channels: number; devices: number; tags: number };
    };
    expect(status.status).toBe("running");
    expect(status.counts).toEqual({ channels: 1, devices: 1, tags: 1 });
  });

  it("serves the event log with filters", async () => {
    events.info("server", "started");
    events.warning("mqtt", "connection lost");
    events.error("mqtt", "broker unreachable");

    const all = (await (await fetch(`${base}/api/events`)).json()) as { message: string }[];
    expect(all.map((e) => e.message)).toEqual([
      "started",
      "connection lost",
      "broker unreachable",
    ]);

    const filtered = (await (
      await fetch(`${base}/api/events?severity=error&source=mqtt`)
    ).json()) as { message: string }[];
    expect(filtered.map((e) => e.message)).toEqual(["broker unreachable"]);

    const limited = (await (
      await fetch(`${base}/api/events?limit=2`)
    ).json()) as { message: string }[];
    expect(limited.map((e) => e.message)).toEqual(["connection lost", "broker unreachable"]);

    const badSeverity = await fetch(`${base}/api/events?severity=nope`);
    expect(badSeverity.status).toBe(400);
  });
});
