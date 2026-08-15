import { describe, expect, it } from "vitest";
import {
  MqttAgentSchema,
  TagSchema,
  type TagValue,
} from "@odiserver/core";
import {
  exceedsDeadband,
  renderPayload,
  renderTopic,
  resolvePublishConfig,
  type PublishContext,
} from "../src/mqtt/render.js";

const ctx: PublishContext = {
  channelId: "ch1",
  channelName: "Line 1",
  deviceId: "dev1",
  deviceName: "PLC 1",
  tagId: "dev1.temp",
  tagName: "Temperature",
  dataType: "float32",
};

function agent(overrides: Record<string, unknown> = {}) {
  return MqttAgentSchema.parse({ id: "agent1", name: "Agent 1", url: "mqtt://localhost:1883", ...overrides });
}

function tag(overrides: Record<string, unknown> = {}) {
  return TagSchema.parse({
    id: "dev1.temp",
    deviceId: "dev1",
    name: "Temperature",
    address: "40001",
    dataType: "float32",
    ...overrides,
  });
}

const value: TagValue = { value: 21.5, quality: "good", timestamp: 1720000000000 };

describe("renderTopic", () => {
  it("substitutes hierarchy tokens", () => {
    expect(renderTopic("odiserver/{channel}/{device}/{tag}", ctx)).toBe(
      "odiserver/Line 1/PLC 1/Temperature",
    );
  });

  it("substitutes id and datatype tokens and leaves unknown tokens intact", () => {
    expect(renderTopic("site/{channelId}/{deviceId}/{tagId}/{dataType}/{unknown}", ctx)).toBe(
      "site/ch1/dev1/dev1.temp/float32/{unknown}",
    );
  });
});

describe("renderPayload", () => {
  it("renders the default JSON document", () => {
    expect(JSON.parse(renderPayload("default", "", ctx, value))).toEqual({
      tag: "Temperature",
      value: 21.5,
      quality: "good",
      timestamp: 1720000000000,
    });
  });

  it("renders a template with a typed {value} token", () => {
    const out = renderPayload(
      "template",
      '{"name":"{tag}","v":{value},"q":"{quality}","ts":{timestamp}}',
      ctx,
      value,
    );
    expect(JSON.parse(out)).toEqual({ name: "Temperature", v: 21.5, q: "good", ts: 1720000000000 });
  });

  it("renders raw value templates", () => {
    expect(renderPayload("template", "{value}", ctx, value)).toBe("21.5");
    expect(renderPayload("template", "{value}", ctx, { ...value, value: "RUN" })).toBe('"RUN"');
  });
});

describe("resolvePublishConfig", () => {
  it("inherits agent defaults when the tag has no override", () => {
    const resolved = resolvePublishConfig(agent(), tag());
    expect(resolved).toMatchObject({
      topic: "odiserver/{channel}/{device}/{tag}",
      mode: "on-change",
      intervalMs: 5000,
      deadband: 0,
      qos: 0,
      retain: false,
      payloadFormat: "default",
    });
  });

  it("applies per-tag overrides on top of agent defaults", () => {
    const resolved = resolvePublishConfig(
      agent({ mode: "interval", intervalMs: 10000 }),
      tag({ mqtt: { agent1: { topic: "custom/{tag}", deadband: 2, qos: 1, retain: true } } }),
    );
    expect(resolved).toMatchObject({
      topic: "custom/{tag}",
      mode: "interval", // inherited
      intervalMs: 10000, // inherited
      deadband: 2,
      qos: 1,
      retain: true,
    });
  });

  it("returns null when the tag opts out of the agent", () => {
    expect(resolvePublishConfig(agent(), tag({ mqtt: { agent1: { enabled: false } } }))).toBeNull();
    // Opt-out for a different agent does not affect this one.
    expect(resolvePublishConfig(agent(), tag({ mqtt: { other: { enabled: false } } }))).not.toBeNull();
  });
});

describe("exceedsDeadband", () => {
  it("always publishes the first value", () => {
    expect(exceedsDeadband(undefined, 1, 100)).toBe(true);
  });

  it("applies the absolute deadband to numbers", () => {
    expect(exceedsDeadband(10, 14.9, 5)).toBe(false);
    expect(exceedsDeadband(10, 15.1, 5)).toBe(true);
  });

  it("publishes null transitions and non-number changes", () => {
    expect(exceedsDeadband(null, null, 0)).toBe(false);
    expect(exceedsDeadband(1, null, 0)).toBe(true);
    expect(exceedsDeadband("a", "a", 0)).toBe(false);
    expect(exceedsDeadband("a", "b", 0)).toBe(true);
    expect(exceedsDeadband(true, false, 0)).toBe(true);
  });
});
