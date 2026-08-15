import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigStore, MqttAgentSchema, TagEngine } from "@odiserver/core";
import {
  MqttAgentRuntime,
  type MqttClientLike,
} from "../src/mqtt/agent-runtime.js";
import type { IClientOptions } from "mqtt";

class FakeMqttClient implements MqttClientLike {
  connected = false;
  ended = false;
  published: { topic: string; payload: string; opts: { qos: 0 | 1 | 2; retain: boolean } }[] = [];
  private handlers = new Map<string, ((...args: never[]) => void)[]>();

  on(event: string, listener: (...args: never[]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(listener);
    this.handlers.set(event, list);
  }

  emit(event: string, ...args: never[]): void {
    for (const listener of this.handlers.get(event) ?? []) listener(...args);
  }

  connect(): void {
    this.connected = true;
    this.emit("connect");
  }

  publish(topic: string, payload: string, opts: { qos: 0 | 1 | 2; retain: boolean }): void {
    this.published.push({ topic, payload, opts });
  }

  end(): void {
    this.ended = true;
    this.connected = false;
  }
}

function seedStore() {
  const store = new ConfigStore(":memory:");
  store.upsertChannel({ id: "ch1", name: "Channel 1", driver: "modbus-tcp", enabled: true, settings: {} });
  store.upsertDevice({ id: "dev1", channelId: "ch1", name: "Device 1", enabled: true, settings: {} });
  const engine = new TagEngine();
  return { store, engine };
}

function addTag(store: ConfigStore, engine: TagEngine, id: string, mqtt?: Record<string, unknown>) {
  store.upsertTag({
    id,
    deviceId: "dev1",
    name: id,
    address: "40001",
    dataType: "float32",
    scanRateMs: 100,
    deadband: 0,
    mqtt: mqtt ?? {},
  } as never);
  engine.load(store.listTags());
}

function makeRuntime(agentConfig: Record<string, unknown>, seed: ReturnType<typeof seedStore>) {
  const clients: FakeMqttClient[] = [];
  const connectFn = (_url: string, _options: IClientOptions) => {
    const client = new FakeMqttClient();
    clients.push(client);
    return client;
  };
  const runtime = new MqttAgentRuntime({
    agent: MqttAgentSchema.parse({
      id: "agent1",
      name: "Agent 1",
      url: "mqtt://localhost:1883",
      ...agentConfig,
    }),
    engine: seed.engine,
    store: seed.store,
    connectFn,
  });
  return { runtime, clients };
}

describe("MqttAgentRuntime", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not connect when the agent is disabled", () => {
    const seed = seedStore();
    const { runtime, clients } = makeRuntime({ enabled: false }, seed);
    expect(clients).toHaveLength(0);
    expect(runtime.getStatus().state).toBe("disabled");
    seed.store.close();
  });

  it("publishes a snapshot of all tags on connect", () => {
    const seed = seedStore();
    addTag(seed.store, seed.engine, "dev1.t1");
    addTag(seed.store, seed.engine, "dev1.t2");
    seed.engine.updateRaw("dev1.t1", 10);
    seed.engine.updateRaw("dev1.t2", 20);

    const { runtime, clients } = makeRuntime({}, seed);
    expect(runtime.getStatus().state).toBe("connecting");
    clients[0].connect();

    expect(runtime.getStatus().state).toBe("connected");
    const topics = clients[0].published.map((p) => p.topic).sort();
    expect(topics).toEqual([
      "odiserver/Channel 1/Device 1/dev1.t1",
      "odiserver/Channel 1/Device 1/dev1.t2",
    ]);
    const first = clients[0].published.find((p) => p.topic.endsWith("dev1.t1"))!;
    expect(JSON.parse(first.payload)).toMatchObject({ tag: "dev1.t1", value: 10, quality: "good" });
    runtime.stop();
    seed.store.close();
  });

  it("publishes on-change events and applies the agent deadband", () => {
    const seed = seedStore();
    addTag(seed.store, seed.engine, "dev1.t1");
    const { runtime, clients } = makeRuntime({ deadband: 5 }, seed);
    const client = clients[0];
    client.connect();
    client.published.length = 0;

    seed.engine.updateRaw("dev1.t1", 10); // first report -> publish
    seed.engine.updateRaw("dev1.t1", 13); // within deadband of 10 -> suppressed
    seed.engine.updateRaw("dev1.t1", 16); // beyond deadband -> publish

    const values = client.published.map((p) => JSON.parse(p.payload).value);
    expect(values).toEqual([10, 16]);
    expect(runtime.getStatus().publishedCount).toBe(3); // snapshot + 2 changes
    runtime.stop();
    seed.store.close();
  });

  it("always publishes quality changes", () => {
    const seed = seedStore();
    addTag(seed.store, seed.engine, "dev1.t1");
    const { clients } = makeRuntime({ deadband: 100 }, seed);
    const client = clients[0];
    client.connect();
    client.published.length = 0;

    seed.engine.updateRaw("dev1.t1", 10);
    seed.engine.setQuality("dev1.t1", "bad", "comm failure");
    seed.engine.updateRaw("dev1.t1", 10); // same value, quality restored

    const qualities = client.published.map((p) => JSON.parse(p.payload).quality);
    expect(qualities).toEqual(["good", "bad", "good"]);
  });

  it("skips tags opted out and honors per-tag topic/template overrides", () => {
    const seed = seedStore();
    addTag(seed.store, seed.engine, "dev1.t1", { agent1: { enabled: false } });
    addTag(seed.store, seed.engine, "dev1.t2", {
      agent1: { topic: "custom/{tagId}", payloadFormat: "template", payloadTemplate: "{value}" },
    });
    const { clients } = makeRuntime({}, seed);
    const client = clients[0];
    client.connect();
    client.published.length = 0;

    seed.engine.updateRaw("dev1.t1", 1);
    seed.engine.updateRaw("dev1.t2", 42);

    expect(client.published).toHaveLength(1);
    expect(client.published[0].topic).toBe("custom/dev1.t2");
    expect(client.published[0].payload).toBe("42");
    seed.store.close();
  });

  it("publishes current values on the interval timer in interval mode", () => {
    const seed = seedStore();
    addTag(seed.store, seed.engine, "dev1.t1");
    seed.engine.updateRaw("dev1.t1", 7);
    const { clients } = makeRuntime({ mode: "interval", intervalMs: 1000 }, seed);
    const client = clients[0];
    client.connect();
    client.published.length = 0;

    vi.advanceTimersByTime(3100);
    expect(client.published).toHaveLength(3);
    expect(JSON.parse(client.published[0].payload).value).toBe(7);

    // While disconnected, interval publishes are skipped (no stale backlog).
    client.connected = false;
    vi.advanceTimersByTime(3000);
    expect(client.published).toHaveLength(3);
    seed.store.close();
  });

  it("records broker errors in its status without crashing", () => {
    const seed = seedStore();
    const { runtime, clients } = makeRuntime({}, seed);
    clients[0].emit("error", new Error("connection refused") as never);
    expect(runtime.getStatus().state).toBe("error");
    expect(runtime.getStatus().lastError).toBe("connection refused");
    runtime.stop();
    seed.store.close();
  });
});
