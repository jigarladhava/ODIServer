import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ConfigStore, TagEngine, tagsToCsv } from "@odiserver/core";
import { createApiApp } from "../src/index.js";

let server: Server;
let base: string;
let store: ConfigStore;

beforeAll(async () => {
  store = new ConfigStore(":memory:");
  const engine = new TagEngine();
  const app = createApiApp({ store, engine, startedAt: Date.now() });
  server = createServer(app);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Seed: ch1 / d1 / two tags
  await post("/api/channels", { id: "ch1", name: "Channel 1", driver: "modbus-tcp" });
  await post("/api/devices", { id: "d1", channelId: "ch1", name: "PLC 1", settings: { host: "10.0.0.5", port: 502 } });
  await post("/api/tags", { id: "d1.t1", deviceId: "d1", name: "Temp", address: "40001", dataType: "float32", byteOrder: "word-swap" });
  await post("/api/tags", { id: "d1.t2", deviceId: "d1", name: "Valve", address: "00001", dataType: "bool" });
});

afterAll(async () => {
  await new Promise((res) => server.close(res));
  store.close();
});

async function post(path: string, body: unknown, contentType = "application/json"): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: contentType === "application/json" ? JSON.stringify(body) : String(body),
  });
}

describe("project export/import", () => {
  it("exports the project as a downloadable JSON file", async () => {
    const res = await fetch(`${base}/api/project/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="odiserver-project-.*\.json"/);
    const body = (await res.json()) as { channels: unknown[]; devices: unknown[]; tags: unknown[] };
    expect(body.channels).toHaveLength(1);
    expect(body.devices).toHaveLength(1);
    expect(body.tags).toHaveLength(2);
  });

  it("imports a project in replace mode", async () => {
    const replacement = {
      channels: [{ id: "ch9", name: "New", driver: "opcua-client", enabled: true, settings: {} }],
      devices: [{ id: "d9", channelId: "ch9", name: "Dev9", enabled: true, settings: {} }],
      tags: [],
    };
    const res = await post("/api/project/import?mode=replace", replacement);
    expect(res.status).toBe(200);
    const project = (await (await fetch(`${base}/api/project`)).json()) as {
      channels: { id: string }[];
      devices: { id: string }[];
    };
    expect(project.channels.map((c) => c.id)).toEqual(["ch9"]);
    expect(project.devices.map((d) => d.id)).toEqual(["d9"]);
  });

  it("imports a project in merge mode, keeping existing entities", async () => {
    const res = await post("/api/project/import?mode=merge", {
      channels: [{ id: "ch10", name: "Merged", driver: "modbus-rtu", enabled: true, settings: {} }],
      devices: [],
      tags: [],
    });
    expect(res.status).toBe(200);
    const project = (await (await fetch(`${base}/api/project`)).json()) as { channels: { id: string }[] };
    expect(project.channels.map((c) => c.id).sort()).toEqual(["ch10", "ch9"]);
  });

  it("rejects an invalid project payload with 400", async () => {
    const res = await post("/api/project/import", { channels: [{ id: "x" }], devices: [], tags: [] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.length).toBeGreaterThan(0);
  });
});

describe("device export/import", () => {
  it("exports a device bundle with its tags", async () => {
    // Re-seed a device with tags (previous tests replaced the project).
    await post("/api/channels", { id: "ch1", name: "Channel 1", driver: "modbus-tcp" });
    await post("/api/devices", { id: "d1", channelId: "ch1", name: "PLC 1", settings: { host: "10.0.0.5" } });
    await post("/api/tags", { id: "d1.t1", deviceId: "d1", name: "Temp", address: "40001", dataType: "float32" });

    const res = await fetch(`${base}/api/devices/d1/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/device-PLC 1\.json/);
    const bundle = (await res.json()) as { format: string; device: { id: string }; tags: unknown[] };
    expect(bundle.format).toBe("odiserver-device");
    expect(bundle.device.id).toBe("d1");
    expect(bundle.tags).toHaveLength(1);
  });

  it("imports a device bundle into a target channel", async () => {
    const bundle = {
      format: "odiserver-device",
      version: 1,
      device: { id: "d2", channelId: "ignored", name: "PLC 2", enabled: true, settings: { host: "10.0.0.6" } },
      tags: [
        { id: "d2.t1", deviceId: "ignored", name: "Pressure", address: "40010", dataType: "uint16" },
      ],
    };
    const res = await post("/api/devices/import?channel=ch1", bundle);
    expect(res.status).toBe(201);
    const device = (await (await fetch(`${base}/api/devices/d2`)).json()) as { channelId: string };
    expect(device.channelId).toBe("ch1");
    const tag = (await (await fetch(`${base}/api/tags/d2.t1`)).json()) as { deviceId: string };
    expect(tag.deviceId).toBe("d2");
  });

  it("rejects device import into an unknown channel", async () => {
    const bundle = {
      format: "odiserver-device",
      version: 1,
      device: { id: "d3", channelId: "ghost", name: "PLC 3", enabled: true, settings: {} },
      tags: [],
    };
    const res = await post("/api/devices/import", bundle);
    expect(res.status).toBe(400);
  });

  it("returns 404 exporting a missing device", async () => {
    const res = await fetch(`${base}/api/devices/nope/export`);
    expect(res.status).toBe(404);
  });
});

describe("tag CSV export/import", () => {
  it("exports tags as CSV with a header row", async () => {
    const res = await fetch(`${base}/api/tags/export?device=d1&format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    expect(lines[0]).toContain("name");
    expect(lines[0]).toContain("address");
    expect(lines.length).toBeGreaterThanOrEqual(2); // header + at least one tag
  });

  it("exports tags as JSON when format=json", async () => {
    const res = await fetch(`${base}/api/tags/export?device=d1&format=json`);
    expect(res.status).toBe(200);
    const tags = (await res.json()) as { id: string }[];
    expect(tags.some((t) => t.id === "d1.t1")).toBe(true);
  });

  it("imports tags from CSV into a device", async () => {
    const csv = [
      "name,address,dataType,scanRateMs,description",
      "CSV Tag 1,40020,uint16,250,from csv",
      'CSV Tag 2,40021,float32,,"quoted, description"',
    ].join("\r\n");
    const res = await post("/api/tags/import?device=d1", csv, "text/csv");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { imported: { tags: number } };
    expect(body.imported.tags).toBe(2);
    const tags = (await (await fetch(`${base}/api/tags?parent=d1`)).json()) as { name: string; scanRateMs: number }[];
    const csvTag = tags.find((t) => t.name === "CSV Tag 1");
    expect(csvTag?.scanRateMs).toBe(250);
  });

  it("imports tags from a JSON array", async () => {
    const res = await post("/api/tags/import?device=d1", [
      { id: "d1.json1", name: "JSON Tag", address: "40030", dataType: "int16" },
    ]);
    expect(res.status).toBe(201);
    const tag = (await (await fetch(`${base}/api/tags/d1.json1`)).json()) as { deviceId: string };
    expect(tag.deviceId).toBe("d1");
  });

  it("rejects CSV with unknown dataType", async () => {
    const res = await post("/api/tags/import?device=d1", "name,address,dataType\nBad,40099,bogus\n", "text/csv");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/dataType/);
  });

  it("requires the device query parameter", async () => {
    const res = await post("/api/tags/import", "name,address\nT,40001\n", "text/csv");
    expect(res.status).toBe(400);
  });

  it("round-trips: exported CSV re-imports to identical tags", async () => {
    const exported = await (await fetch(`${base}/api/tags/export?device=d1&format=csv`)).text();
    const before = (await (await fetch(`${base}/api/tags?parent=d1`)).json()) as unknown[];
    const res = await post("/api/tags/import?device=d1", exported, "text/csv");
    expect(res.status).toBe(201);
    const after = (await (await fetch(`${base}/api/tags?parent=d1`)).json()) as unknown[];
    expect(after).toEqual(before);
  });

  it("importing another device's CSV copies tags with fresh IDs instead of moving them", async () => {
    const csv = await (await fetch(`${base}/api/tags/export?device=d1&format=csv`)).text();
    const d1Before = (await (await fetch(`${base}/api/tags?parent=d1`)).json()) as { id: string; name: string }[];

    const res = await post("/api/tags/import?device=d2", csv, "text/csv");
    expect(res.status).toBe(201);

    // Source device untouched.
    const d1After = (await (await fetch(`${base}/api/tags?parent=d1`)).json()) as { id: string; name: string }[];
    expect(d1After).toEqual(d1Before);

    // Target device got copies: same names, new IDs bound to d2.
    const d2Tags = (await (await fetch(`${base}/api/tags?parent=d2`)).json()) as {
      id: string;
      name: string;
      deviceId: string;
    }[];
    const d1Ids = new Set(d1Before.map((t) => t.id));
    for (const source of d1Before) {
      const copy = d2Tags.find((t) => t.name === source.name);
      expect(copy, `copy of ${source.name}`).toBeDefined();
      expect(copy!.deviceId).toBe("d2");
      expect(d1Ids.has(copy!.id)).toBe(false);
    }
  });

  it("importing another device's JSON array copies tags with fresh IDs instead of moving them", async () => {
    const json = await (await fetch(`${base}/api/tags/export?device=d1&format=json`)).json();
    const d1Before = (await (await fetch(`${base}/api/tags?parent=d1`)).json()) as { id: string; name: string }[];

    const res = await post("/api/tags/import?device=d2", json);
    expect(res.status).toBe(201);

    const d1After = (await (await fetch(`${base}/api/tags?parent=d1`)).json()) as { id: string; name: string }[];
    expect(d1After).toEqual(d1Before);

    const d2Tags = (await (await fetch(`${base}/api/tags?parent=d2`)).json()) as { id: string; name: string }[];
    const d1Ids = new Set(d1Before.map((t) => t.id));
    const copies = d2Tags.filter((t) => d1Before.some((s) => s.name === t.name));
    expect(copies.length).toBeGreaterThanOrEqual(d1Before.length);
    for (const copy of copies) expect(d1Ids.has(copy.id)).toBe(false);
  });
});
