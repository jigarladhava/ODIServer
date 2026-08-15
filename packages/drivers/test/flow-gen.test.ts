import { describe, expect, it } from "vitest";
import { parseModbusAddress } from "../src/modbus-address.js";
import { generateFlows, ODI_TAB_ID } from "../src/flow-gen.js";
import type { ProjectConfig } from "@odiserver/core";

describe("parseModbusAddress", () => {
  it("parses holding register 40001 as offset 0", () => {
    expect(parseModbusAddress("40001")).toMatchObject({
      table: "holding",
      offset: 0,
      readDataType: "HoldingRegister",
      registerCount: 1,
    });
  });

  it("parses each table prefix", () => {
    expect(parseModbusAddress("00001").table).toBe("coil");
    expect(parseModbusAddress("10001").table).toBe("discrete");
    expect(parseModbusAddress("30001").table).toBe("input");
    expect(parseModbusAddress("40001").table).toBe("holding");
  });

  it("handles 6-digit addresses", () => {
    expect(parseModbusAddress("400101").offset).toBe(100);
  });

  it("uses 2 registers for 32-bit types and 4 for float64", () => {
    expect(parseModbusAddress("40001", "float32").registerCount).toBe(2);
    expect(parseModbusAddress("40001", "uint32").registerCount).toBe(2);
    expect(parseModbusAddress("40001", "float64").registerCount).toBe(4);
    expect(parseModbusAddress("00001", "bool").registerCount).toBe(1);
  });

  it("rejects invalid addresses", () => {
    expect(() => parseModbusAddress("20001")).toThrow();
    expect(() => parseModbusAddress("abc")).toThrow();
    expect(() => parseModbusAddress("4000010")).toThrow();
  });
});

function project(): ProjectConfig {
  return {
    channels: [
      { id: "ch1", name: "Modbus Line 1", driver: "modbus-tcp", enabled: true, settings: {} },
      { id: "ch2", name: "Disabled", driver: "modbus-tcp", enabled: false, settings: {} },
    ],
    devices: [
      { id: "dev1", channelId: "ch1", name: "PLC-01", enabled: true, settings: { host: "192.168.1.10", port: 502, unitId: 1 } },
      { id: "dev2", channelId: "ch2", name: "PLC-02", enabled: true, settings: { host: "192.168.1.11", port: 502, unitId: 1 } },
    ],
    tags: [
      { id: "tag1", deviceId: "dev1", name: "Temperature", address: "40001", dataType: "uint16", scanRateMs: 1000, deadband: 0, scaling: { enabled: false, rawMin: 0, rawMax: 100, engMin: 0, engMax: 100 }, description: "" },
      { id: "tag2", deviceId: "dev1", name: "Pressure", address: "40003", dataType: "float32", scanRateMs: 5000, deadband: 0, scaling: { enabled: false, rawMin: 0, rawMax: 100, engMin: 0, engMax: 100 }, description: "" },
      { id: "tag3", deviceId: "dev2", name: "OnDisabledChannel", address: "40001", dataType: "uint16", scanRateMs: 1000, deadband: 0, scaling: { enabled: false, rawMin: 0, rawMax: 100, engMin: 0, engMax: 100 }, description: "" },
      { id: "tag4", deviceId: "dev1", name: "BadAddress", address: "99999", dataType: "uint16", scanRateMs: 1000, deadband: 0, scaling: { enabled: false, rawMin: 0, rawMax: 100, engMin: 0, engMax: 100 }, description: "" },
    ],
  };
}

describe("generateFlows", () => {
  it("creates one client per active modbus-tcp device with tags", () => {
    const flows = generateFlows(project());
    const clients = flows.filter((n) => n.type === "modbus-client");
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ id: "odi-client-dev1", tcpHost: "192.168.1.10", tcpPort: "502" });
  });

  it("creates read + bridge + catch nodes per valid tag, skipping disabled channels and bad addresses", () => {
    const flows = generateFlows(project());
    const reads = flows.filter((n) => n.type === "modbus-read");
    expect(reads.map((r) => r.id).sort()).toEqual(["odi-read-tag1", "odi-read-tag2"]);
    expect(flows.filter((n) => n.type === "odi-tag-in")).toHaveLength(5); // value + error bridge per tag + device link bridge
    expect(flows.filter((n) => n.type === "catch")).toHaveLength(2);
  });

  it("watches each device client node for connection loss", () => {
    const flows = generateFlows(project());
    const status = flows.find((n) => n.id === "odi-status-dev1")!;
    expect(status).toMatchObject({ type: "status", scope: ["odi-client-dev1"] });
    expect(status.wires).toEqual([["odi-bridge-dev-dev1"]]);
    const devBridge = flows.find((n) => n.id === "odi-bridge-dev-dev1")!;
    expect(devBridge).toMatchObject({ type: "odi-tag-in", mode: "device-quality", deviceId: "dev1" });
  });

  it("enables emptyMsgOnFail so read errors reach the bridge", () => {
    const flows = generateFlows(project());
    for (const read of flows.filter((n) => n.type === "modbus-read")) {
      expect(read.emptyMsgOnFail).toBe(true);
    }
  });

  it("maps address, datatype, quantity and scan rate onto the read node", () => {
    const flows = generateFlows(project());
    const read2 = flows.find((n) => n.id === "odi-read-tag2")!;
    expect(read2).toMatchObject({
      dataType: "HoldingRegister",
      adr: "2",
      quantity: "2",
      rate: "5000",
      rateUnit: "ms",
      server: "odi-client-dev1",
    });
    const bridge = flows.find((n) => n.id === "odi-bridge-tag2")!;
    expect(bridge).toMatchObject({ type: "odi-tag-in", tagId: "tag2", mode: "value" });
    expect(read2.wires).toEqual([["odi-bridge-tag2"], []]);
  });

  it("scopes catch nodes to their read node and wires them to a quality bridge", () => {
    const flows = generateFlows(project());
    const catch1 = flows.find((n) => n.id === "odi-catch-tag1")!;
    expect(catch1.scope).toEqual(["odi-read-tag1"]);
    expect(catch1.wires).toEqual([["odi-bridge-err-tag1"]]);
    const errBridge = flows.find((n) => n.id === "odi-bridge-err-tag1")!;
    expect(errBridge).toMatchObject({ mode: "quality", quality: "bad" });
  });

  it("applies per-device comm settings to the client node", () => {
    const p = project();
    p.devices[0].settings = {
      ...p.devices[0].settings,
      requestTimeoutMs: 1500,
      interRequestDelayMs: 25,
    };
    const flows = generateFlows(p);
    const client = flows.find((n) => n.id === "odi-client-dev1")!;
    expect(client.clientTimeout).toBe("1500");
    expect(client.commandDelay).toBe("25");
  });

  it("respect-device scan mode polls every tag at the device rate", () => {
    const p = project();
    p.devices[0].settings = {
      ...p.devices[0].settings,
      scanMode: "respect-device",
      scanModeRateMs: 250,
    };
    const flows = generateFlows(p);
    const reads = flows.filter((n) => n.type === "modbus-read");
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect(read.rate).toBe("250");
  });

  it("generates write bridge + modbus-write nodes for rw tags on writable tables", () => {
    const p = project();
    p.tags[0] = { ...p.tags[0], access: "rw" as const }; // tag1: holding uint16
    p.tags[1] = { ...p.tags[1], access: "rw" as const }; // tag2: holding float32
    const flows = generateFlows(p);
    const out = flows.find((n) => n.id === "odi-out-tag1")!;
    expect(out).toMatchObject({ type: "odi-tag-out", tagId: "tag1", wires: [["odi-write-tag1"]] });
    const write = flows.find((n) => n.id === "odi-write-tag2")!;
    expect(write).toMatchObject({
      type: "modbus-write",
      dataType: "HoldingRegister",
      adr: "2",
      quantity: "2",
      server: "odi-client-dev1",
    });
  });

  it("generates no write nodes for read-only tags", () => {
    const p = project();
    p.tags[0] = { ...p.tags[0], access: "ro" as const };
    p.tags[1] = { ...p.tags[1], access: "ro" as const };
    const flows = generateFlows(p);
    expect(flows.filter((n) => n.type === "modbus-write")).toHaveLength(0);
    expect(flows.filter((n) => n.type === "odi-tag-out")).toHaveLength(0);
  });

  it("all nodes live on the ODI tab", () => {
    const flows = generateFlows(project());
    for (const node of flows.filter((n) => n.type !== "tab")) {
      expect(node.z).toBe(ODI_TAB_ID);
    }
  });
});

function makeTag(
  id: string,
  address: string,
  dataType: ProjectConfig["tags"][number]["dataType"] = "uint16",
  scanRateMs = 1000,
): ProjectConfig["tags"][number] {
  return {
    id,
    deviceId: "dev1",
    name: id,
    address,
    dataType,
    byteOrder: "big-endian",
    scanRateMs,
    deadband: 0,
    scaling: { enabled: false, rawMin: 0, rawMax: 100, engMin: 0, engMax: 100 },
    description: "",
  };
}

function projectWith(
  tags: ProjectConfig["tags"],
  deviceSettings: Record<string, unknown> = {},
): ProjectConfig {
  return {
    channels: [{ id: "ch1", name: "Modbus Line 1", driver: "modbus-tcp", enabled: true, settings: {} }],
    devices: [
      {
        id: "dev1",
        channelId: "ch1",
        name: "PLC-01",
        enabled: true,
        settings: { host: "192.168.1.10", port: 502, unitId: 1, ...deviceSettings },
      },
    ],
    tags,
  };
}

function readIds(flows: ReturnType<typeof generateFlows>): string[] {
  return flows.filter((n) => n.type === "modbus-read").map((n) => n.id).sort();
}

describe("block reads", () => {
  it("merges adjacent same-rate tags into one block read", () => {
    const flows = generateFlows(
      projectWith([makeTag("t1", "40001"), makeTag("t2", "40002"), makeTag("t3", "40005")]),
    );
    const reads = flows.filter((n) => n.type === "modbus-read");
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({
      id: "odi-read-block-dev1-holding-0",
      dataType: "HoldingRegister",
      adr: "0",
      quantity: "5",
      rate: "1000",
      server: "odi-client-dev1",
      emptyMsgOnFail: true,
    });
    expect(reads[0].wires).toEqual([["odi-bridge-t1", "odi-bridge-t2", "odi-bridge-t3"], []]);
  });

  it("gives each member bridge its slice offset and register count", () => {
    const flows = generateFlows(
      projectWith([makeTag("t1", "40001"), makeTag("t2", "40003", "float32")]),
    );
    expect(flows.find((n) => n.id === "odi-bridge-t1")).toMatchObject({ blockOffset: 0, blockCount: 1 });
    expect(flows.find((n) => n.id === "odi-bridge-t2")).toMatchObject({ blockOffset: 2, blockCount: 2 });
  });

  it("marks all member tags bad from one catch node when the block read fails", () => {
    const flows = generateFlows(projectWith([makeTag("t1", "40001"), makeTag("t2", "40002")]));
    const catchNode = flows.find((n) => n.type === "catch")!;
    expect(catchNode.scope).toEqual(["odi-read-block-dev1-holding-0"]);
    expect(catchNode.wires).toEqual([["odi-bridge-err-t1", "odi-bridge-err-t2"]]);
  });

  it("keeps tags with different scan rates in separate reads", () => {
    const flows = generateFlows(
      projectWith([makeTag("t1", "40001", "uint16", 1000), makeTag("t2", "40002", "uint16", 5000)]),
    );
    expect(readIds(flows)).toEqual(["odi-read-t1", "odi-read-t2"]);
  });

  it("starts a new block when the address hole exceeds maxGap", () => {
    // 40001 -> offset 0, 40020 -> offset 19: hole of 18 > default maxGap 8
    const flows = generateFlows(projectWith([makeTag("t1", "40001"), makeTag("t2", "40020")]));
    expect(readIds(flows)).toEqual(["odi-read-t1", "odi-read-t2"]);
  });

  it("splits blocks at maxBlockSize without splitting multi-register values", () => {
    const flows = generateFlows(
      projectWith([makeTag("t1", "40001", "uint16"), makeTag("t2", "40002", "float64")], { maxBlockSize: 4 }),
    );
    // merged span would be 5 registers > 4, so the float64 gets its own read
    expect(readIds(flows)).toEqual(["odi-read-t1", "odi-read-t2"]);
    expect(flows.find((n) => n.id === "odi-read-t2")).toMatchObject({ quantity: "4" });
  });

  it("caps the block span at maxBlockSize", () => {
    const tags = [1, 2, 3, 4, 5].map((i) => makeTag(`t${i}`, `4000${i}`));
    const flows = generateFlows(projectWith(tags, { maxBlockSize: 4 }));
    const reads = flows.filter((n) => n.type === "modbus-read");
    expect(readIds(flows)).toEqual(["odi-read-block-dev1-holding-0", "odi-read-t5"]);
    expect(reads[0]).toMatchObject({ adr: "0", quantity: "4" });
  });

  it("does not merge tags across tables", () => {
    const flows = generateFlows(projectWith([makeTag("t1", "30001"), makeTag("t2", "40001")]));
    expect(readIds(flows)).toEqual(["odi-read-t1", "odi-read-t2"]);
  });

  it("falls back to per-tag reads when blockReads is disabled", () => {
    const flows = generateFlows(
      projectWith([makeTag("t1", "40001"), makeTag("t2", "40002")], { blockReads: false }),
    );
    expect(readIds(flows)).toEqual(["odi-read-t1", "odi-read-t2"]);
    for (const bridge of flows.filter((n) => n.type === "odi-tag-in" && n.mode === "value")) {
      expect(bridge.blockOffset).toBeUndefined();
    }
  });

  it("does not self-reference its own id in any string property (Node-RED circular config check)", () => {
    // Generated nodes have no x/y, so Node-RED classifies them as config
    // nodes and treats any property value matching a config id as a
    // dependency — a self-reference aborts the flow start.
    const flows = generateFlows(projectWith([makeTag("t1", "40001"), makeTag("t2", "40002")]));
    for (const node of flows) {
      for (const [key, value] of Object.entries(node)) {
        if (key !== "id" && typeof value === "string") {
          expect(value).not.toBe(node.id);
        }
      }
    }
  });

  it("merges coils within the default gap", () => {
    const flows = generateFlows(projectWith([makeTag("t1", "00001", "bool"), makeTag("t2", "00009", "bool")]));
    const reads = flows.filter((n) => n.type === "modbus-read");
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ dataType: "Coil", adr: "0", quantity: "9" });
  });
});
