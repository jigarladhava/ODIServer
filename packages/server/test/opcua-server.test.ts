import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttributeIds,
  ClientSubscription,
  DataType,
  DataValue,
  MessageSecurityMode,
  OPCUAClient,
  SecurityPolicy,
  StatusCodes,
  TimestampsToReturn,
  Variant,
  type ClientSession,
  type ReferenceDescription,
} from "node-opcua";
import { ConfigStore, TagEngine, type TagConfig } from "@odiserver/core";
import { startOpcUaServer, type OpcUaServerHandle } from "../src/opcua-server.js";

const PORT = 14932;
const endpoint = `opc.tcp://127.0.0.1:${PORT}`;

let certsDir: string;
let store: ConfigStore;
let engine: TagEngine;
let server: OpcUaServerHandle;
let client: OPCUAClient;
let session: ClientSession;

async function browse(nodeId: string): Promise<ReferenceDescription[]> {
  const result = await session.browse(nodeId);
  return result.references ?? [];
}

beforeAll(async () => {
  certsDir = mkdtempSync(join(tmpdir(), "odiserver-opcua-certs-"));
  store = new ConfigStore(":memory:");
  engine = new TagEngine();
  store.upsertChannel({ id: "ch1", name: "Channel 1", driver: "modbus-tcp", enabled: true, settings: {} });
  store.upsertDevice({ id: "d1", channelId: "ch1", name: "PLC 1", enabled: true, settings: {} });
  store.upsertTag({ id: "d1.temp", deviceId: "d1", name: "Temp", address: "40001", dataType: "float32" } as TagConfig);
  store.upsertTag({ id: "d1.running", deviceId: "d1", name: "Running", address: "00001", dataType: "bool" } as TagConfig);
  store.upsertTag({ id: "d1.count", deviceId: "d1", name: "Count", address: "40003", dataType: "uint16" } as TagConfig);
  engine.load(store.listTags());

  // The test exercises address-space behavior, not auth: opt into the
  // anonymous/cleartext development mode the lockdown disables by default.
  process.env.ODISERVER_OPCUA_ALLOW_INSECURE = "1";
  server = await startOpcUaServer({ engine, store, port: PORT, certsDir, allowAnonymous: true });

  client = OPCUAClient.create({
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    endpointMustExist: false,
    requestedSessionTimeout: 30000,
  });
  await client.connect(endpoint);
  session = await client.createSession();
}, 90000);

afterAll(async () => {
  delete process.env.ODISERVER_OPCUA_ALLOW_INSECURE;
  await session?.close(true).catch(() => {});
  await client?.disconnect().catch(() => {});
  await server?.stop().catch(() => {});
  store?.close();
  rmSync(certsDir, { recursive: true, force: true });
}, 30000);

describe("OPC UA server", () => {
  it("exposes channel -> device -> tags tree", async () => {
    const channel = (await browse("ObjectsFolder")).find((r) => r.browseName.name === "Channel 1");
    expect(channel).toBeDefined();
    expect(channel!.nodeId.toString()).toBe("ns=1;s=Channel 1");

    const device = (await browse(channel!.nodeId.toString())).find((r) => r.browseName.name === "PLC 1");
    expect(device).toBeDefined();
    expect(device!.nodeId.toString()).toBe("ns=1;s=Channel 1.PLC 1");

    const tagNames = (await browse(device!.nodeId.toString())).map((r) => r.browseName.name).sort();
    expect(tagNames).toEqual(["Count", "Running", "Temp", "_Statistics", "_System"]);
  });

  it("exposes per-device _System and _Statistics nodes", async () => {
    const system = (await browse("ns=1;s=Channel 1.PLC 1._System")).map((r) => r.browseName.name).sort();
    expect(system).toEqual(["_Description", "_Enabled", "_Error"]);

    const stats = (await browse("ns=1;s=Channel 1.PLC 1._Statistics")).map((r) => r.browseName.name).sort();
    expect(stats).toEqual(["_FailedReads", "_FailedWrites", "_SuccessfulReads", "_SuccessfulWrites"]);

    const enabled = await session.readVariableValue("ns=1;s=Channel 1.PLC 1._System._Enabled");
    expect(enabled.value.value).toBe(true);
  });

  it("serves live tag values with quality", async () => {
    engine.updateRaw("d1.temp", 21.5);
    const good = await session.readVariableValue("ns=1;s=Channel 1.PLC 1.Temp");
    expect(good.statusCode).toEqual(StatusCodes.Good);
    expect(good.value.value).toBeCloseTo(21.5, 5);

    engine.setQuality("d1.temp", "bad", "comm failure");
    const bad = await session.readVariableValue("ns=1;s=Channel 1.PLC 1.Temp");
    expect(bad.statusCode).toEqual(StatusCodes.Bad);
  });

  it("maps tag datatypes to OPC UA datatypes", async () => {
    // The DataType attribute is a NodeId into ns=0 (e.g. i=1 is Boolean).
    const running = await session.read({ nodeId: "ns=1;s=Channel 1.PLC 1.Running", attributeId: AttributeIds.DataType });
    expect(running.value.value.value).toBe(DataType.Boolean);
    const count = await session.read({ nodeId: "ns=1;s=Channel 1.PLC 1.Count", attributeId: AttributeIds.DataType });
    expect(count.value.value.value).toBe(DataType.UInt16);
  });

  it("pushes tag changes to subscriptions", async () => {
    const subscription = ClientSubscription.create(session, {
      requestedPublishingInterval: 100,
      requestedLifetimeCount: 100,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    });
    try {
      const item = await subscription.monitor(
        { nodeId: "ns=1;s=Channel 1.PLC 1.Count", attributeId: AttributeIds.Value },
        { samplingInterval: 50, discardOldest: true, queueSize: 10 },
        TimestampsToReturn.Both,
      );
      const received = await new Promise<DataValue>((resolveWait, rejectWait) => {
        const timer = setTimeout(() => rejectWait(new Error("no data change within 10s")), 10000);
        item.on("changed", (dataValue: DataValue) => {
          if (dataValue.value.value === 4242) {
            clearTimeout(timer);
            resolveWait(dataValue);
          }
        });
        engine.updateRaw("d1.count", 4242);
      });
      expect(received.value.value).toBe(4242);
      expect(received.statusCode).toEqual(StatusCodes.Good);
    } finally {
      await subscription.terminate();
    }
  });

  it("forwards client writes to the tag engine", async () => {
    const written = new Promise<unknown>((resolveWrite) => engine.once("write", (req) => resolveWrite(req)));
    const status = await session.write({
      nodeId: "ns=1;s=Channel 1.PLC 1.Count",
      attributeId: AttributeIds.Value,
      value: new DataValue({ value: new Variant({ dataType: DataType.UInt16, value: 42 }) }),
    });
    expect(status).toEqual(StatusCodes.Good);
    await expect(written).resolves.toEqual({ tagId: "d1.count", value: 42 });
  });

  it("publishes config changes (new tags become browsable)", async () => {
    store.upsertTag({ id: "d1.extra", deviceId: "d1", name: "Extra", address: "40010", dataType: "int16" } as TagConfig);
    await new Promise((r) => setTimeout(r, 1000)); // rebuild is debounced (250ms)
    const device = await session.read({ nodeId: "ns=1;s=Channel 1.PLC 1", attributeId: AttributeIds.BrowseName });
    expect(device.statusCode).toEqual(StatusCodes.Good);
    const value = await session.readVariableValue("ns=1;s=Channel 1.PLC 1.Extra");
    expect(value.statusCode).toEqual(StatusCodes.Bad); // configured but no data yet
  });
});
