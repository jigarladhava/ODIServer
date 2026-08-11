import { z } from "zod";
import { BYTE_ORDERS, DATA_TYPES, DRIVER_TYPES } from "./types.js";

/**
 * Configuration schema for the channel/device/tag model.
 * Driver-specific settings are validated per driver; core keeps them as
 * typed records so new drivers can be added without schema migrations.
 */

export const ScalingSchema = z.object({
  enabled: z.boolean().default(false),
  rawMin: z.number().default(0),
  rawMax: z.number().default(100),
  engMin: z.number().default(0),
  engMax: z.number().default(100),
});
export type Scaling = z.infer<typeof ScalingSchema>;

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
  description: z.string().default(""),
});
export type TagConfig = z.infer<typeof TagSchema>;

/** Full project configuration tree. */
export const ProjectSchema = z.object({
  channels: z.array(ChannelSchema).default([]),
  devices: z.array(DeviceSchema).default([]),
  tags: z.array(TagSchema).default([]),
});
export type ProjectConfig = z.infer<typeof ProjectSchema>;
