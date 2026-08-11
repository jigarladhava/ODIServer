import { describe, expect, it } from "vitest";
import { ConfigStore } from "../src/store.js";

function channel(id = "ch1") {
  return { id, name: "Channel 1", driver: "modbus-tcp", enabled: true, settings: {} };
}
function device(id = "dev1", channelId = "ch1") {
  return { id, channelId, name: "Device 1", enabled: true, settings: { host: "127.0.0.1", port: 502, unitId: 1 } };
}
function tag(id = "tag1", deviceId = "dev1") {
  return {
    id,
    deviceId,
    name: "Tag 1",
    address: "40001",
    dataType: "uint16",
    scanRateMs: 1000,
    deadband: 0,
    scaling: { enabled: false, rawMin: 0, rawMax: 100, engMin: 0, engMax: 100 },
    description: "",
  };
}

describe("ConfigStore", () => {
  it("round-trips channels, devices and tags", () => {
    const store = new ConfigStore(":memory:");
    store.upsertChannel(channel());
    store.upsertDevice(device());
    store.upsertTag(tag());

    expect(store.getChannel("ch1")?.name).toBe("Channel 1");
    expect(store.getDevice("dev1")?.channelId).toBe("ch1");
    expect(store.getTag("tag1")?.address).toBe("40001");
    expect(store.getProject().tags).toHaveLength(1);
    store.close();
  });

  it("rejects devices for unknown channels and tags for unknown devices", () => {
    const store = new ConfigStore(":memory:");
    expect(() => store.upsertDevice(device())).toThrow(/Unknown channel/);
    store.upsertChannel(channel());
    expect(() => store.upsertTag(tag())).toThrow(/Unknown device/);
    store.close();
  });

  it("validates with zod and applies defaults", () => {
    const store = new ConfigStore(":memory:");
    store.upsertChannel(channel());
    store.upsertDevice(device());
    const saved = store.upsertTag({ ...tag(), scanRateMs: undefined } as never);
    expect(saved.scanRateMs).toBe(1000);
    store.close();
  });

  it("cascades channel removal to devices and tags", () => {
    const store = new ConfigStore(":memory:");
    store.upsertChannel(channel());
    store.upsertDevice(device());
    store.upsertTag(tag());
    expect(store.removeChannel("ch1")).toBe(true);
    expect(store.listDevices()).toHaveLength(0);
    expect(store.listTags()).toHaveLength(0);
    store.close();
  });

  it("emits change events on mutation", () => {
    const store = new ConfigStore(":memory:");
    const events: unknown[] = [];
    store.on("change", (e) => events.push(e));
    store.upsertChannel(channel());
    store.removeChannel("ch1");
    expect(events).toEqual([
      { kind: "channel", action: "upsert", id: "ch1" },
      { kind: "channel", action: "remove", id: "ch1" },
    ]);
    store.close();
  });
});
