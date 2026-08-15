export type Quality = 'good' | 'uncertain' | 'bad';
export type Driver = 'modbus-tcp' | 'modbus-rtu' | 'opcua-client';
export type DataType =
  | 'bool'
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'int64'
  | 'uint64'
  | 'float32'
  | 'float64'
  | 'bcd'
  | 'lbcd'
  | 'date'
  | 'string';

export type EntityKind = 'channel' | 'device' | 'tag';

export type ByteOrder = 'big-endian' | 'word-swap' | 'byte-swap' | 'little-endian';

export type TagAccess = 'ro' | 'rw';

export interface Channel {
  id: string;
  name: string;
  driver: Driver;
  enabled: boolean;
  settings: Record<string, unknown>;
}

export interface Device {
  id: string;
  channelId: string;
  name: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

export interface TagScaling {
  enabled: boolean;
  type: 'linear' | 'square-root';
  rawMin: number;
  rawMax: number;
  engMin: number;
  engMax: number;
  clampLow: boolean;
  clampHigh: boolean;
  negate: boolean;
}

/** Per-tag, per-agent MQTT publish override; absent fields inherit the agent defaults. */
export interface MqttTagOverride {
  enabled?: boolean;
  topic?: string;
  mode?: 'on-change' | 'interval';
  intervalMs?: number;
  deadband?: number;
  qos?: 0 | 1 | 2;
  retain?: boolean;
  payloadFormat?: 'default' | 'template';
  payloadTemplate?: string;
}

export interface Tag {
  id: string;
  deviceId: string;
  name: string;
  address: string;
  dataType: DataType;
  /** Client write access; "ro" tags reject writes (server defaults to "rw"). */
  access?: TagAccess;
  scanRateMs: number;
  deadband: number;
  scaling: TagScaling;
  description: string;
  /** Multi-register Modbus assembly order; server defaults to "big-endian". */
  byteOrder?: ByteOrder;
  /** Per-agent MQTT publish overrides, keyed by agent id. Absent = inherit agent defaults. */
  mqtt?: Record<string, MqttTagOverride>;
}

export interface MqttTls {
  rejectUnauthorized: boolean;
  caPath?: string;
  certPath?: string;
  keyPath?: string;
}

export interface MqttLwt {
  enabled: boolean;
  topic: string;
  onlinePayload: string;
  offlinePayload: string;
}

export interface MqttAgent {
  id: string;
  name: string;
  enabled: boolean;
  url: string;
  clientId: string;
  username?: string;
  password?: string;
  keepaliveSec: number;
  clean: boolean;
  tls: MqttTls;
  mode: 'on-change' | 'interval';
  intervalMs: number;
  deadband: number;
  qos: 0 | 1 | 2;
  retain: boolean;
  topicPattern: string;
  payloadFormat: 'default' | 'template';
  payloadTemplate: string;
  lwt: MqttLwt;
}

export interface MqttAgentStatus {
  state: 'disabled' | 'connecting' | 'connected' | 'error';
  lastError?: string;
  publishedCount: number;
  lastPublishAt?: number;
}

export interface Project {
  channels: Channel[];
  devices: Device[];
  tags: Tag[];
  mqttAgents: MqttAgent[];
}

export interface TagValue {
  value: number | boolean | string | null;
  quality: Quality;
  timestamp: number;
  /** Last driver error message; present when quality is not good. */
  error?: string;
}

export type ValueMap = Record<string, TagValue>;

export interface ValueChange extends TagValue {
  tagId: string;
}

export interface ServerStatus {
  status: string;
  uptimeMs: number;
  counts: { channels: number; devices: number; tags: number };
}
