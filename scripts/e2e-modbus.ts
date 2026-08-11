/**
 * Phase 1 end-to-end verification: Modbus TCP simulator -> ODIServer.
 *
 * Starts a jsmodbus TCP server with known register values, boots ODIServer
 * against a temp data dir, creates channel/device/tags over the REST API,
 * then asserts live values arrive in the tag engine and on the WebSocket.
 *
 * Run from the repo root:  npx tsx scripts/e2e-modbus.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTcpServer } from "node:net";
import { WebSocket } from "ws";
import modbus from "jsmodbus";
import { startOdiServer } from "@odiserver/server";

const MODBUS_PORT = 15020;
const API_PORT = 18080;

// Register layout exposed by the simulator:
//   holding 0 (40001) = 1234        -> tag "RawCount"  (uint16)
//   holding 1 (40002) = 500         -> tag "ScaledTemp" (uint16, scaled 0..1000 -> 0..100)
//   holding 2-3 (40003) = 25.5f     -> tag "Pressure"   (float32 big-endian, 0x41CC0000)
const HOLDING = { 0: 1234, 1: 500 };

function startSimulator(): Promise<{ close(): void }> {
  return new Promise((resolveServer) => {
    // jsmodbus v4 buffer-based server: register N sits at byte offset N*2
    const holding = Buffer.alloc(16);
    holding.writeUInt16BE(HOLDING[0], 0); // 40001
    holding.writeUInt16BE(HOLDING[1], 2); // 40002
    holding.writeFloatBE(25.5, 4); // 40003 (float32, big-endian)
    const sockets = new Set<import("node:net").Socket>();
    const server = createTcpServer();
    new modbus.server.TCP(server, { holding });
    server.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    server.listen(MODBUS_PORT, "127.0.0.1", () =>
      resolveServer({
        close: () => {
          server.close();
          for (const s of sockets) s.destroy(); // close() alone keeps existing links alive
        },
      }),
    );
  });
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`http://127.0.0.1:${API_PORT}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${message}`);
}

const dataDir = mkdtempSync(join(tmpdir(), "odiserver-e2e-"));
let exitCode = 0;
let server: Awaited<ReturnType<typeof startOdiServer>> | undefined;
let simulator: { close(): void } | undefined;

try {
  simulator = await startSimulator();
  console.log(`[e2e] modbus simulator on 127.0.0.1:${MODBUS_PORT}`);

  server = await startOdiServer({ port: API_PORT, dataDir, opcua: { enabled: false } });
  console.log(`[e2e] ODIServer on :${API_PORT}`);

  // Configure channel -> device -> tags via REST
  const post = (path: string, body: unknown) =>
    api(path, { method: "POST", body: JSON.stringify(body) }).then(async (r) => {
      if (!r.ok) throw new Error(`POST ${path} -> ${r.status}: ${await r.text()}`);
      return r.json();
    });

  await post("/api/channels", { id: "ch1", name: "Sim Channel", driver: "modbus-tcp", enabled: true, settings: {} });
  await post("/api/devices", { id: "dev1", channelId: "ch1", name: "Sim PLC", enabled: true, settings: { host: "127.0.0.1", port: MODBUS_PORT, unitId: 1 } });
  await post("/api/tags", { id: "tag-raw", deviceId: "dev1", name: "RawCount", address: "40001", dataType: "uint16", scanRateMs: 500 });
  await post("/api/tags", {
    id: "tag-temp", deviceId: "dev1", name: "ScaledTemp", address: "40002", dataType: "uint16", scanRateMs: 500,
    scaling: { enabled: true, rawMin: 0, rawMax: 1000, engMin: 0, engMax: 100 },
  });
  await post("/api/tags", { id: "tag-float", deviceId: "dev1", name: "Pressure", address: "40003", dataType: "float32", scanRateMs: 500 });
  // Out-of-range address: simulator only has holding registers 0..7
  await post("/api/tags", { id: "tag-oob", deviceId: "dev1", name: "DoesNotExist", address: "40020", dataType: "uint16", scanRateMs: 500 });
  console.log("[e2e] config created, waiting for polls...");

  // WebSocket must deliver tag changes
  const wsValues = new Map<string, { value: unknown; quality: string; error?: string }>();
  await new Promise<void>((resolveWs, rejectWs) => {
    const ws = new WebSocket(`ws://127.0.0.1:${API_PORT}/ws`);
    const timer = setTimeout(() => rejectWs(new Error("timeout waiting for WS tag changes")), 15000);
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data));
      if (msg.type === "change") {
        wsValues.set(msg.data.tagId, { value: msg.data.value, quality: msg.data.quality, error: msg.data.error });
        if (wsValues.has("tag-raw") && wsValues.has("tag-temp") && wsValues.has("tag-float") && wsValues.has("tag-oob")) {
          clearTimeout(timer);
          ws.close();
          resolveWs();
        }
      }
    });
    ws.on("error", rejectWs);
  });

  assert(wsValues.get("tag-raw")?.value === 1234, `tag-raw expected 1234, got ${wsValues.get("tag-raw")?.value}`);
  assert(wsValues.get("tag-raw")?.quality === "good", "tag-raw quality should be good");
  assert(wsValues.get("tag-temp")?.value === 50, `tag-temp expected scaled 50, got ${wsValues.get("tag-temp")?.value}`);
  assert(wsValues.get("tag-float")?.value === 25.5, `tag-float expected 25.5, got ${wsValues.get("tag-float")?.value}`);
  assert(wsValues.get("tag-oob")?.quality === "bad", "tag-oob quality should be bad");
  assert(
    String(wsValues.get("tag-oob")?.error ?? "").length > 0,
    "tag-oob should carry a driver error message",
  );
  console.log("[e2e] WebSocket values OK:", Object.fromEntries(wsValues));

  // REST read-back
  const rest = await (await api("/api/values/tag-raw")).json();
  assert(rest.value === 1234 && rest.quality === "good", "REST /api/values/tag-raw mismatch");
  const status = await (await api("/api/status")).json();
  assert(status.counts.tags === 4, "status should report 4 tags");
  console.log("[e2e] REST values OK");

  // Device-down: kill the simulator, tags of that device must go bad with a
  // communication error (device-down behavior).
  simulator.close();
  await new Promise<void>((resolveWs, rejectWs) => {
    const ws = new WebSocket(`ws://127.0.0.1:${API_PORT}/ws`);
    const timer = setTimeout(() => rejectWs(new Error("timeout waiting for device-down quality")), 15000);
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data));
      if (msg.type === "change" && msg.data.tagId === "tag-raw" && msg.data.quality === "bad" && msg.data.error) {
        clearTimeout(timer);
        console.log(`[e2e] device-down error surfaced: "${msg.data.error}"`);
        ws.close();
        resolveWs();
      }
    });
    ws.on("error", rejectWs);
  });
  console.log("[e2e] device-down propagation OK");

  console.log("[e2e] PASS");
} catch (err) {
  exitCode = 1;
  console.error("[e2e] FAIL:", err);
} finally {
  // node-red-contrib-modbus can hold RED.stop() open on active sockets;
  // don't let shutdown hang the verification.
  await Promise.race([
    (async () => {
      await server?.stop().catch(() => {});
      try {
        simulator?.close();
      } catch {
        /* already closed */
      }
    })(),
    new Promise((res) => setTimeout(res, 10000)),
  ]);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(exitCode);
}
