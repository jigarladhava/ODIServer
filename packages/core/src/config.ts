import { z } from "zod";
import { BYTE_ORDERS, DATA_TYPES, DRIVER_TYPES, TAG_ACCESS } from "./types.js";

/**
 * Configuration schema for the channel/device/tag model.
 * Driver-specific settings are validated per driver; core keeps them as
 * typed records so new drivers can be added without schema migrations.
 */

export const ScalingSchema = z.object({
  enabled: z.boolean().default(false),
  /** linear = straight interpolation; square-root = flow-style √ scaling. */
  type: z.enum(["linear", "square-root"]).default("linear"),
  rawMin: z.number().default(0),
  rawMax: z.number().default(100),
  engMin: z.number().default(0),
  engMax: z.number().default(100),
  /** Clamp the scaled value to engMin / engMax. */
  clampLow: z.boolean().default(false),
  clampHigh: z.boolean().default(false),
  /** Multiply the scaled value by -1 (applied after clamping). */
  negate: z.boolean().default(false),
});
export type Scaling = z.infer<typeof ScalingSchema>;

/** TLS options for an MQTT agent broker connection (mqtts://). */
export const MqttTlsSchema = z.object({
  rejectUnauthorized: z.boolean().default(true),
  /** Optional PEM file paths (relative to the data dir or absolute). */
  caPath: z.string().optional(),
  certPath: z.string().optional(),
  keyPath: z.string().optional(),
});
export type MqttTls = z.infer<typeof MqttTlsSchema>;

/** Last-will / birth-death settings for an MQTT agent. */
export const MqttLwtSchema = z.object({
  enabled: z.boolean().default(false),
  topic: z.string().default(""),
  onlinePayload: z.string().default("online"),
  offlinePayload: z.string().default("offline"),
});
export type MqttLwt = z.infer<typeof MqttLwtSchema>;

export const MQTT_PUBLISH_MODES = ["on-change", "interval"] as const;

/**
 * A northbound MQTT publishing agent. Each agent connects to one broker and
 * publishes tag data with the defaults below; individual tags can override
 * or disable publishing per agent via TagSchema.mqtt[agentId].
 *
 * Topic/payload tokens: {channel} {channelId} {device} {deviceId} {tag}
 * {tagId} {dataType} plus {value} {quality} {timestamp} in payloads.
 * {value} is substituted JSON-encoded so numbers/booleans stay typed.
 */
export const MqttAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  /** Broker URL, e.g. mqtt://host:1883, mqtts://host:8883, ws://host:8083 */
  url: z.string().min(1),
  /** Empty = let the client generate one. */
  clientId: z.string().default(""),
  username: z.string().optional(),
  password: z.string().optional(),
  keepaliveSec: z.number().int().min(0).default(60),
  clean: z.boolean().default(true),
  tls: MqttTlsSchema.default({ rejectUnauthorized: true }),

  // ---- publish defaults ("parent" settings; tags may override) ----
  /** on-change = publish on tag change events; interval = publish on a timer. */
  mode: z.enum(MQTT_PUBLISH_MODES).default("on-change"),
  /** Timer period for interval mode. */
  intervalMs: z.number().int().min(100).default(5000),
  /** Extra agent-side absolute deadband on the scaled value; 0 = every engine change. */
  deadband: z.number().min(0).default(0),
  qos: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  retain: z.boolean().default(false),
  topicPattern: z.string().min(1).default("odiserver/{channel}/{device}/{tag}"),
  /** default = built-in JSON; template = user payloadTemplate. */
  payloadFormat: z.enum(["default", "template"]).default("default"),
  payloadTemplate: z.string().default(""),
  lwt: MqttLwtSchema.default({
    enabled: false,
    topic: "",
    onlinePayload: "online",
    offlinePayload: "offline",
  }),
});
export type MqttAgentConfig = z.infer<typeof MqttAgentSchema>;

/**
 * Per-tag, per-agent publish override. Every field is optional; absent
 * fields inherit the agent's defaults. `enabled: false` opts the tag out
 * of publishing for that agent.
 */
export const MqttTagOverrideSchema = z.object({
  enabled: z.boolean().default(true),
  topic: z.string().optional(),
  mode: z.enum(MQTT_PUBLISH_MODES).optional(),
  intervalMs: z.number().int().min(100).optional(),
  deadband: z.number().min(0).optional(),
  qos: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  retain: z.boolean().optional(),
  payloadFormat: z.enum(["default", "template"]).optional(),
  payloadTemplate: z.string().optional(),
});
export type MqttTagOverride = z.infer<typeof MqttTagOverrideSchema>;

export const ChannelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  driver: z.enum(DRIVER_TYPES as [string, ...string[]]),
  enabled: z.boolean().default(true),
  /** Driver-specific comm settings, e.g. modbus-rtu serial params */
  settings: z.record(z.unknown()).default({}),
});
export type ChannelConfig = z.infer<typeof ChannelSchema>;

export const DeviceSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  /** Driver-specific device settings, e.g. { host, port, unitId } for modbus-tcp */
  settings: z.record(z.unknown()).default({}),
});
export type DeviceConfig = z.infer<typeof DeviceSchema>;

export const TagSchema = z.object({
  id: z.string().min(1),
  deviceId: z.string().min(1),
  name: z.string().min(1),
  /** Driver-specific address string, e.g. "40001" (modbus) or "ns=2;s=..." (opcua) */
  address: z.string().min(1),
  dataType: z.enum(DATA_TYPES as [string, ...string[]]),
  /** Register byte/word ordering for multi-register values (Modbus). */
  byteOrder: z.enum(BYTE_ORDERS as [string, ...string[]]).default("big-endian"),
  /** Client write access; "ro" tags reject writes at the engine. */
  access: z.enum(TAG_ACCESS as [string, ...string[]]).default("rw"),
  scanRateMs: z.number().int().min(50).default(1000),
  /** Absolute deadband on the scaled value; 0 = report every change */
  deadband: z.number().min(0).default(0),
  scaling: ScalingSchema.default({
    enabled: false,
    rawMin: 0,
    rawMax: 100,
    engMin: 0,
    engMax: 100,
  }),
  /** Per-agent MQTT publish overrides, keyed by agent id. Absent = inherit agent defaults. */
  mqtt: z.record(z.string(), MqttTagOverrideSchema).default({}),
  description: z.string().default(""),
});
export type TagConfig = z.infer<typeof TagSchema>;

/** Full project configuration tree. */
export const ProjectSchema = z.object({
  channels: z.array(ChannelSchema).default([]),
  devices: z.array(DeviceSchema).default([]),
  tags: z.array(TagSchema).default([]),
  mqttAgents: z.array(MqttAgentSchema).default([]),
});
export type ProjectConfig = z.infer<typeof ProjectSchema>;
