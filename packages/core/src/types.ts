/**
 * Shared value/quality types for ODIServer.
 * Quality follows OPC semantics: good | uncertain | bad.
 */

export type Quality = "good" | "uncertain" | "bad";

export type TagPrimitive = number | boolean | string;

export interface TagValue {
  value: TagPrimitive | null;
  quality: Quality;
  /** Unix epoch milliseconds */
  timestamp: number;
  /** Last driver error message (present when quality is not good). */
  error?: string;
}

export type DataType =
  | "bool"
  | "int8"
  | "uint8"
  | "int16"
  | "uint16"
  | "int32"
  | "uint32"
  | "int64"
  | "uint64"
  | "float32"
  | "float64"
  | "bcd"
  | "lbcd"
  | "date"
  | "string";

export const DATA_TYPES: readonly DataType[] = [
  "bool",
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "int64",
  "uint64",
  "float32",
  "float64",
  "bcd",
  "lbcd",
  "date",
  "string",
];

/** Tag write access: "ro" tags reject client writes at the engine. */
export type TagAccess = "ro" | "rw";

export const TAG_ACCESS: readonly TagAccess[] = ["ro", "rw"];

export type DriverType = "modbus-tcp" | "modbus-rtu" | "opcua-client";

export const DRIVER_TYPES: readonly DriverType[] = [
  "modbus-tcp",
  "modbus-rtu",
  "opcua-client",
];

/**
 * Byte/word ordering for multi-register values (Modbus endianness).
 * Letters refer to the byte sequence of the assembled value:
 *   big-endian    AB CD      (default; registers in order, each big-endian)
 *   word-swap     CD AB      (16-bit word order reversed)
 *   byte-swap     BA DC      (bytes swapped within each word)
 *   little-endian DC BA      (full byte reverse)
 */
export type ByteOrder = "big-endian" | "word-swap" | "byte-swap" | "little-endian";

export const BYTE_ORDERS: readonly ByteOrder[] = [
  "big-endian",
  "word-swap",
  "byte-swap",
  "little-endian",
];
