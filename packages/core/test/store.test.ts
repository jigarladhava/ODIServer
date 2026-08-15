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

  it("round-trips MQTT agents with schema defaults", () => {
    const store = new ConfigStore(":memory:");
    const saved = store.upsertMqttAgent({
      id: "agent1",
      name: "Agent 1",
      url: "mqtt://localhost:1883",
    } as never);

    // Defaults applied by the schema.
    expect(saved.enabled).toBe(true);
    expect(saved.mode).toBe("on-change");
    expect(saved.intervalMs).toBe(5000);
    expect(saved.qos).toBe(0);
    expect(saved.retain).toBe(false);
    expect(saved.topicPattern).toBe("odiserver/{channel}/{device}/{tag}");
    expect(saved.payloadFormat).toBe("default");
    expect(saved.tls.rejectUnauthorized).toBe(true);
    expect(saved.lwt.enabled).toBe(false);

    expect(store.getMqttAgent("agent1")?.url).toBe("mqtt://localhost:1883");
    expect(store.listMqttAgents()).toHaveLength(1);
    expect(store.removeMqttAgent("agent1")).toBe(true);
    expect(store.listMqttAgents()).toHaveLength(0);
    store.close();
  });

  it("round-trips per-tag MQTT overrides", () => {
    const store = new ConfigStore(":memory:");
    store.upsertChannel(channel());
    store.upsertDevice(device());
    store.upsertTag({
      ...tag(),
      mqtt: { agent1: { enabled: false }, agent2: { topic: "custom/{tag}", deadband: 5 } },
    } as never);

    const loaded = store.getTag("tag1");
    expect(loaded?.mqtt.agent1?.enabled).toBe(false);
    expect(loaded?.mqtt.agent2?.topic).toBe("custom/{tag}");
    expect(loaded?.mqtt.agent2?.deadband).toBe(5);
    // A tag without overrides defaults to an empty map.
    store.upsertTag({ ...tag("tag2") } as never);
    expect(store.getTag("tag2")?.mqtt).toEqual({});
    store.close();
  });

  it("includes MQTT agents in project export/import", () => {
    const store = new ConfigStore(":memory:");
    store.upsertChannel(channel());
    store.upsertDevice(device());
    store.upsertTag(tag() as never);
    store.upsertMqttAgent({ id: "agent1", name: "Agent 1", url: "mqtt://localhost:1883" } as never);

    const project = store.getProject();
    expect(project.mqttAgents).toHaveLength(1);

    const store2 = new ConfigStore(":memory:");
    store2.replaceProject(JSON.parse(JSON.stringify(project)));
    expect(store2.listMqttAgents()).toHaveLength(1);
    expect(store2.getMqttAgent("agent1")?.name).toBe("Agent 1");
    expect(store2.listTags()).toHaveLength(1);
    store.close();
    store2.close();
  });
});
