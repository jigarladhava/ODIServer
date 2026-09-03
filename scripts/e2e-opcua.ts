/**
 * Phase 5 end-to-end verification: OPC UA server -> ODIServer -> OPC UA client.
 *
 * Stands up a Kepware-style mock OPC UA server (tags at ns=2;s=Channel.Device.Tag),
 * boots ODIServer with an opcua-client channel pointing at it, imports the
 * project over the REST API, then asserts:
 *   1. subscribed values land in the tag engine (good quality)
 *   2. the values are served on ODIServer's own OPC UA server (ns=1 mirror)
 *   3. a write through ODIServer's OPC UA server reaches the mock server
 *
 * Run from the repo root:  npx tsx scripts/e2e-opcua.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AddressSpace,
  AttributeIds,
  DataType,
  DataValue,
  OPCUAClient,
  OPCUAServer,
  StatusCodes,
  Variant,
  type UAVariable,
} from "node-opcua";
import { startOdiServer } from "@odiserver/server";

const MOCK_PORT = 54841;
const NORTHBOUND_PORT = 54932;
const API_PORT = 18081;

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${message}`);
}

async function waitFor(cond: () => boolean | Promise<boolean>, what: string, timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`TIMEOUT waiting for: ${what}`);
}

/** Kepware-style mock: tags live at ns=2 with s=Channel.Device.Tag nodeIds. */
async function startMockKepware(): Promise<{ server: OPCUAServer; stop(): Promise<void>; written: { value: number | null } }> {
  const written = { value: null as number | null };
  const server = new OPCUAServer({ port: MOCK_PORT, resourcePath: "" });
  await server.initialize();
  const addressSpace: AddressSpace = server.engine.addressSpace!;
  // Kepware exposes project tags at ns=2 (ns=1 is its own server namespace);
  // registering one extra namespace here lands at index 2 the same way.
  const ns = addressSpace.registerNamespace("urn:mock:kepware:project");

  const channel = ns.addObject({ organizedBy: addressSpace.rootFolder.objects, browseName: "SiteA" });
  const device = ns.addObject({ organizedBy: channel, browseName: "Incomer1" });

  let t = 0;
  ns.addVariable({
    componentOf: device,
    browseName: "Voltage",
    nodeId: "s=SiteA.Incomer1.Voltage",
    dataType: "Float",
    value: {
      timestamped_get: () =>
        new DataValue({ value: new Variant({ dataType: DataType.Float, value: 230 + 10 * Math.sin(t) }) }),
      refreshFunc: (cb) => cb(null, new DataValue({ value: new Variant({ dataType: DataType.Float, value: 230 + 10 * Math.sin(t) }) })),
    },
  });
  ns.addVariable({
    componentOf: device,
    browseName: "Run",
    nodeId: "s=SiteA.Incomer1.Run",
    dataType: "Boolean",
    value: {
      timestamped_get: () => new DataValue({ value: new Variant({ dataType: DataType.Boolean, value: t % 2 === 0 }) }),
      refreshFunc: (cb) => cb(null, new DataValue({ value: new Variant({ dataType: DataType.Boolean, value: t % 2 === 0 }) })),
    },
  });
  let setpoint = 100;
  const setpointVar: UAVariable = ns.addVariable({
    componentOf: device,
    browseName: "Setpoint",
    nodeId: "s=SiteA.Incomer1.Setpoint",
    dataType: "Float",
    value: {
      timestamped_get: () => new DataValue({ value: new Variant({ dataType: DataType.Float, value: setpoint }) }),
      timestamped_set: (dv: DataValue, cb: (err: Error | null, sc: import("node-opcua").StatusCode) => void) => {
        setpoint = Number(dv.value.value);
        written.value = setpoint;
        cb(null, StatusCodes.Good);
      },
      refreshFunc: (cb) => cb(null, new DataValue({ value: new Variant({ dataType: DataType.Float, value: setpoint }) })),
    },
  });
  setpointVar.setValueFromSource(new Variant({ dataType: DataType.Float, value: setpoint }));

  const timer = setInterval(() => {
    t += 1;
    // touch variables so subscriptions see fresh timestamps
    for (const [name, value] of [
      ["Voltage", 230 + 10 * Math.sin(t)],
      ["Run", t % 2 === 0],
      ["Setpoint", setpoint],
    ] as const) {
      const variable = ns.findNode(`s=SiteA.Incomer1.${name}`) as UAVariable | null;
      variable?.setValueFromSource(
        new Variant({ dataType: name === "Run" ? DataType.Boolean : DataType.Float, value: value as number | boolean }),
      );
    }
  }, 400);

  await server.start();
  return {
    server,
    written,
    async stop() {
      clearInterval(timer);
      await server.shutdown();
    },
  };
}

const dataDir = mkdtempSync(join(tmpdir(), "odiserver-e2e-opcua-"));
let exitCode = 0;
let server: Awaited<ReturnType<typeof startOdiServer>> | undefined;
let mock: Awaited<ReturnType<typeof startMockKepware>> | undefined;

try {
  mock = await startMockKepware();
  console.log(`[e2e] mock Kepware-style OPC UA server on opc.tcp://127.0.0.1:${MOCK_PORT}`);

  server = await startOdiServer({ port: API_PORT, dataDir, opcua: { enabled: true, port: NORTHBOUND_PORT } });
  console.log(`[e2e] ODIServer on :${API_PORT}, OPC UA northbound on :${NORTHBOUND_PORT}`);

  const scaling = { enabled: false, type: "linear", rawMin: 0, rawMax: 100, engMin: 0, engMax: 100, clampLow: false, clampHigh: false, negate: false };
  const tag = (id: string, name: string, dataType: string, access: string) => ({
    id,
    deviceId: "sitea.incomer1",
    name,
    address: `ns=2;s=SiteA.Incomer1.${name}`,
    dataType,
    byteOrder: "big-endian",
    access,
    scanRateMs: 500,
    deadband: 0,
    scaling,
    mqtt: {},
    description: "",
  });
  const project = {
    channels: [
      { id: "sitea", name: "SiteA", driver: "opcua-client", enabled: true, settings: { endpointUrl: `opc.tcp://127.0.0.1:${MOCK_PORT}` } },
    ],
    devices: [{ id: "sitea.incomer1", channelId: "sitea", name: "Incomer1", enabled: true, settings: {} }],
    tags: [tag("sitea.incomer1.voltage", "Voltage", "float32", "ro"), tag("sitea.incomer1.run", "Run", "bool", "ro"), tag("sitea.incomer1.setpoint", "Setpoint", "float32", "rw")],
    mqttAgents: [],
  };
  const res = await fetch(`http://127.0.0.1:${API_PORT}/api/project/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(project),
  });
  assert(res.ok, `project import -> ${res.status}: ${await res.text()}`);
  console.log("[e2e] project imported (1 channel, 1 device, 3 tags)");

  // 1. Southbound subscription -> tag engine
  await waitFor(() => server!.engine.getValue("sitea.incomer1.voltage")?.quality === "good", "Voltage good in tag engine");
  const voltage = server.engine.getValue("sitea.incomer1.voltage")!;
  assert(typeof voltage.value === "number" && voltage.value > 200 && voltage.value < 260, `Voltage plausible, got ${String(voltage.value)}`);
  console.log(`[e2e] engine: Voltage = ${String(voltage.value)} (${voltage.quality})`);

  await waitFor(() => server!.engine.getValue("sitea.incomer1.run")?.quality === "good", "Run good in tag engine");
  const run = server.engine.getValue("sitea.incomer1.run")!;
  assert(typeof run.value === "boolean", `Run is boolean, got ${typeof run.value}`);
  console.log(`[e2e] engine: Run = ${String(run.value)} (${run.quality})`);

  // 2. Northbound OPC UA server mirrors the values
  const client = OPCUAClient.create({ endpointMustExist: false });
  await client.connect(`opc.tcp://127.0.0.1:${NORTHBOUND_PORT}`);
  const session = await client.createSession();
  const nbVoltage = await session.read({ nodeId: "ns=1;s=SiteA.Incomer1.Voltage", attributeId: 13 });
  assert(nbVoltage.statusCode.isGood(), `northbound read Voltage good, got ${nbVoltage.statusCode.toString()}`);
  assert(Math.abs(Number(nbVoltage.value.value) - Number(voltage.value)) < 15, "northbound value tracks engine value");
  console.log(`[e2e] northbound: ns=1;s=SiteA.Incomer1.Voltage = ${String(nbVoltage.value.value)}`);

  // 3. Write path: northbound client -> engine -> southbound write -> mock server
  const writeStatus = await session.write({
    nodeId: "ns=1;s=SiteA.Incomer1.Setpoint",
    attributeId: AttributeIds.Value,
    value: new DataValue({ value: new Variant({ dataType: DataType.Float, value: 142.5 }) }),
  });
  console.log(`[e2e] northbound write status: ${writeStatus.toString()}`);
  assert(writeStatus.isGood(), `northbound write accepted, got ${writeStatus.toString()}`);
  await waitFor(() => mock!.written.value === 142.5, "write reaches mock server");
  await waitFor(async () => {
    const v = server!.engine.getValue("sitea.incomer1.setpoint");
    return v?.quality === "good" && Math.abs(Number(v.value) - 142.5) < 0.01;
  }, "written value read back via subscription");
  console.log("[e2e] write 142.5 -> mock server -> subscription read-back OK");

  await session.close();
  await client.disconnect();

  console.log("[e2e] PASS: OPC UA -> ODIServer -> OPC UA chain verified (read + write)");
} catch (err) {
  exitCode = 1;
  console.error("[e2e] FAIL:", err instanceof Error ? err.message : err);
} finally {
  await server?.stop().catch(() => undefined);
  await mock?.stop().catch(() => undefined);
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(exitCode);
