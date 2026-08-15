import { describe, expect, it } from "vitest";
import { ConfigStore } from "../src/store.js";
import {
  buildDeviceExport,
  csvToTags,
  parseCsvRows,
  parseDeviceExport,
  tagsToCsv,
} from "../src/transfer.js";
import type { TagConfig } from "../src/config.js";

function makeTag(overrides: Partial<TagConfig> = {}): TagConfig {
  return {
    id: "d1.t1",
    deviceId: "d1",
    name: "Temperature",
    address: "40001",
    dataType: "float32",
    byteOrder: "word-swap",
    scanRateMs: 500,
    deadband: 0.5,
    scaling: { enabled: true, rawMin: 0, rawMax: 4095, engMin: -40, engMax: 120 },
    mqtt: {},
    description: "Boiler temp, main loop \"A\"",
    ...overrides,
  };
}

describe("tag CSV transfer", () => {
  it("round-trips tags through CSV without data loss", () => {
    const tags = [makeTag(), makeTag({ id: "d1.t2", name: "Valve", address: "00001", dataType: "bool", byteOrder: "big-endian", scaling: { enabled: false, rawMin: 0, rawMax: 100, engMin: 0, engMax: 100 }, description: "" })];
    const csv = tagsToCsv(tags);
    const parsed = csvToTags(csv, "d1");
    expect(parsed).toEqual(tags);
  });

  it("escapes and parses quoted CSV fields (commas, quotes, CRLF)", () => {
    const rows = parseCsvRows('name,description\r\n"Tag, One","say ""hi"""');
    expect(rows).toEqual([
      ["name", "description"],
      ["Tag, One", 'say "hi"'],
    ]);
  });

  it("applies defaults for missing optional columns", () => {
    const parsed = csvToTags("name,address\nMy Tag,40010\n", "dev9");
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: "dev9.my_tag",
      deviceId: "dev9",
      name: "My Tag",
      address: "40010",
      dataType: "uint16",
      byteOrder: "big-endian",
      scanRateMs: 1000,
      deadband: 0,
    });
  });

  it("rejects CSV without name/address headers", () => {
    expect(() => csvToTags("foo,bar\n1,2\n", "d1")).toThrow(/name.*address/);
  });

  it("rejects invalid dataType with a line-numbered error", () => {
    expect(() => csvToTags("name,address,dataType\nT1,40001,not-a-type\n", "d1")).toThrow(
      /Line 2.*dataType/,
    );
  });

  it("rejects non-numeric scanRateMs", () => {
    expect(() => csvToTags("name,address,scanRateMs\nT1,40001,fast\n", "d1")).toThrow(
      /Line 2.*scanRateMs/,
    );
  });
});

describe("device export bundle", () => {
  it("builds and validates a device export", () => {
    const bundle = buildDeviceExport(
      { id: "d1", channelId: "ch1", name: "PLC 1", enabled: true, settings: { host: "10.0.0.5" } },
      [makeTag()],
    );
    const parsed = parseDeviceExport(JSON.parse(JSON.stringify(bundle)));
    expect(parsed.device.id).toBe("d1");
    expect(parsed.tags).toHaveLength(1);
    expect(parsed.format).toBe("odiserver-device");
  });

  it("rejects a malformed bundle", () => {
    expect(() => parseDeviceExport({ format: "other", device: {} })).toThrow();
  });
});

describe("ConfigStore project replace/merge", () => {
  function seedStore(): ConfigStore {
    const store = new ConfigStore(":memory:");
    store.upsertChannel({ id: "ch1", name: "C1", driver: "modbus-tcp", enabled: true, settings: {} });
    store.upsertDevice({ id: "d1", channelId: "ch1", name: "D1", enabled: true, settings: {} });
    store.upsertTag(makeTag());
    return store;
  }

  it("replaceProject swaps the whole configuration atomically", () => {
    const store = seedStore();
    store.replaceProject({
      channels: [{ id: "ch2", name: "C2", driver: "opcua-client", enabled: true, settings: {} }],
      devices: [{ id: "d2", channelId: "ch2", name: "D2", enabled: true, settings: {} }],
      tags: [makeTag({ id: "d2.t1", deviceId: "d2" })],
    });
    expect(store.listChannels().map((c) => c.id)).toEqual(["ch2"]);
    expect(store.listDevices().map((d) => d.id)).toEqual(["d2"]);
    expect(store.listTags().map((t) => t.id)).toEqual(["d2.t1"]);
    store.close();
  });

  it("replaceProject validates and rejects bad payloads without partial writes", () => {
    const store = seedStore();
    expect(() =>
      store.replaceProject({
        channels: [{ id: "bad", name: "", driver: "nope", enabled: true, settings: {} }],
        devices: [],
        tags: [],
      }),
    ).toThrow();
    // Original data intact
    expect(store.listChannels().map((c) => c.id)).toEqual(["ch1"]);
    store.close();
  });

  it("mergeProject upserts without removing existing entities", () => {
    const store = seedStore();
    store.mergeProject({
      channels: [{ id: "ch2", name: "C2", driver: "modbus-rtu", enabled: true, settings: {} }],
      devices: [{ id: "d2", channelId: "ch2", name: "D2", enabled: true, settings: {} }],
      tags: [makeTag({ id: "d2.t1", deviceId: "d2" })],
    });
    expect(store.listChannels().map((c) => c.id).sort()).toEqual(["ch1", "ch2"]);
    expect(store.listTags().map((t) => t.id).sort()).toEqual(["d1.t1", "d2.t1"]);
    store.close();
  });

  it("mergeProject updates existing entities in place", () => {
    const store = seedStore();
    store.mergeProject({
      channels: [{ id: "ch1", name: "C1 renamed", driver: "modbus-tcp", enabled: false, settings: {} }],
      devices: [],
      tags: [],
    });
    expect(store.getChannel("ch1")).toMatchObject({ name: "C1 renamed", enabled: false });
    expect(store.listTags()).toHaveLength(1);
    store.close();
  });

  it("mergeProject rejects tags referencing unknown devices", () => {
    const store = seedStore();
    expect(() =>
      store.mergeProject({
        channels: [],
        devices: [],
        tags: [makeTag({ id: "ghost.t1", deviceId: "ghost" })],
      }),
    ).toThrow(/Unknown device/);
    store.close();
  });
});
