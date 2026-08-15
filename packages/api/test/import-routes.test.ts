import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ConfigStore, TagEngine } from "@odiserver/core";
import { createApiApp, type ImporterPlugin } from "../src/index.js";

/** Fake importer: wraps the posted text into one channel; echoes a warning. */
const fakeImporter: ImporterPlugin = {
  id: "fake-import",
  name: "Fake Format",
  fileExtensions: [".fake"],
  importProject(raw: string) {
    if (raw === "BROKEN") throw new Error("cannot parse fake format");
    return {
      project: {
        channels: [{ id: "ch-fake", name: raw.trim() || "Fake", driver: "modbus-tcp" }],
        devices: [
          { id: "d-fake", channelId: "ch-fake", name: "Dev", settings: { host: "1.2.3.4" } },
        ],
        tags: [],
      },
      warnings: ["fake note"],
    };
  },
};

let server: Server;
let base: string;
let store: ConfigStore;

beforeAll(async () => {
  store = new ConfigStore(":memory:");
  const engine = new TagEngine();
  const app = createApiApp({ store, engine, startedAt: Date.now(), importers: [fakeImporter] });
  server = createServer(app);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((res) => server.close(res));
  store.close();
});

describe("importer plugin routes", () => {
  it("lists the available importers", async () => {
    const res = await fetch(`${base}/api/plugins/importers`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: "fake-import", name: "Fake Format", fileExtensions: [".fake"] },
    ]);
  });

  it("imports a raw file body through the plugin (replace)", async () => {
    const res = await fetch(`${base}/api/project/import-plugin/fake-import?mode=replace`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "From Plugin",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: string;
      imported: { channels: number; devices: number; tags: number };
      warnings: string[];
    };
    expect(body.mode).toBe("replace");
    expect(body.imported).toEqual({ channels: 1, devices: 1, tags: 0 });
    expect(body.warnings).toEqual(["fake note"]);
    expect(store.getChannel("ch-fake")?.name).toBe("From Plugin");
  });

  it("merges when mode=merge", async () => {
    const res = await fetch(`${base}/api/project/import-plugin/fake-import?mode=merge`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "Merged",
    });
    expect(res.status).toBe(200);
    expect(store.getChannel("ch-fake")?.name).toBe("Merged");
  });

  it("returns 404 for an unknown importer", async () => {
    const res = await fetch(`${base}/api/project/import-plugin/nope`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x",
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when the plugin rejects the file", async () => {
    const res = await fetch(`${base}/api/project/import-plugin/fake-import`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "BROKEN",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("cannot parse fake format");
  });
});
