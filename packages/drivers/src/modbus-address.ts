/**
 * Parser for classic Modbus addresses.
 *
 * Supports the classic 5/6-digit notation:
 *   0xxxxx  -> coils (read: FC1, write: FC5)
 *   1xxxxx  -> discrete inputs (FC2)
 *   3xxxxx  -> input registers (FC4)
 *   4xxxxx  -> holding registers (FC3, write: FC6/FC16)
 *
 * The address offset is zero-based: 40001 -> holding register 0.
 */

export type ModbusTable = "coil" | "discrete" | "input" | "holding";

export interface ParsedModbusAddress {
  table: ModbusTable;
  /** Zero-based register/coil offset. */
  offset: number;
  /** node-red-contrib-modbus `dataType` field for the read node. */
  readDataType: "Coil" | "Input" | "InputRegister" | "HoldingRegister";
  /** Number of 16-bit registers the value occupies (always 1 for coils/discretes). */
  registerCount: number;
}

const TABLE_BY_PREFIX: Record<string, { table: ModbusTable; readDataType: ParsedModbusAddress["readDataType"] }> = {
  "0": { table: "coil", readDataType: "Coil" },
  "1": { table: "discrete", readDataType: "Input" },
  "3": { table: "input", readDataType: "InputRegister" },
  "4": { table: "holding", readDataType: "HoldingRegister" },
};

/** Registers per ODIServer datatype (only meaningful for register tables). */
export function registersForDataType(dataType: string): number {
  switch (dataType) {
    case "int32":
    case "uint32":
    case "float32":
      return 2;
    case "float64":
      return 4;
    default:
      return 1;
  }
}

export function parseModbusAddress(address: string, dataType = "uint16"): ParsedModbusAddress {
  const trimmed = address.trim();
  if (!/^\d{5,6}$/.test(trimmed)) {
    throw new Error(`Invalid Modbus address "${address}": expected 5 or 6 digits (e.g. 40001)`);
  }
  const prefix = TABLE_BY_PREFIX[trimmed[0]];
  if (!prefix) {
    throw new Error(`Invalid Modbus address "${address}": must start with 0, 1, 3 or 4`);
  }
  const base = trimmed.length === 6 ? 100000 : 10000;
  const offset = Number.parseInt(trimmed, 10) - (Number(trimmed[0]) * base + 1);
  if (offset < 0 || offset > 65535) {
    throw new Error(`Invalid Modbus address "${address}": offset out of range`);
  }
  const registerCount =
    prefix.table === "coil" || prefix.table === "discrete" ? 1 : registersForDataType(dataType);
  return { table: prefix.table, offset, readDataType: prefix.readDataType, registerCount };
}
