/**
 * Byte/word ordering for multi-register Modbus values.
 *
 * Modbus transmits each 16-bit register big-endian. Drivers hand us an
 * array of register values (0..65535) in wire order; these helpers reorder
 * the underlying bytes per the tag's configured byteOrder and decode the
 * numeric value.
 *
 * Byte-letter convention (for a 32-bit value over 2 registers):
 *   big-endian    AB CD      default; registers in order, each big-endian
 *   word-swap     CD AB      16-bit word order reversed
 *   byte-swap     BA DC      bytes swapped within each word
 *   little-endian DC BA      full byte reverse
 */
'use strict'

/** Reorder a byte array per byteOrder. Every ordering is an involution
 *  (applying it twice restores the input), so the same function maps
 *  wire->logical and logical->wire. */
function reorderBytes(bytes, byteOrder) {
  switch (byteOrder) {
    case 'word-swap': {
      const out = []
      for (let i = bytes.length - 2; i >= 0; i -= 2) out.push(bytes[i], bytes[i + 1])
      return out
    }
    case 'byte-swap': {
      const out = []
      for (let i = 0; i < bytes.length; i += 2) out.push(bytes[i + 1], bytes[i])
      return out
    }
    case 'little-endian':
      return bytes.slice().reverse()
    case 'big-endian':
    default:
      return bytes
  }
}

/** Registers (big-endian wire order) -> reordered byte array per byteOrder. */
function orderBytes(registers, byteOrder) {
  const bytes = []
  for (const reg of registers) {
    bytes.push((reg >> 8) & 0xff, reg & 0xff)
  }
  return reorderBytes(bytes, byteOrder)
}

/** Decode a 16-bit register as unsigned BCD (4 nibbles -> decimal digits). */
function decodeBcd(bytes) {
  let value = 0
  for (const byte of bytes) {
    const hi = (byte >> 4) & 0x0f
    const lo = byte & 0x0f
    if (hi > 9 || lo > 9) return NaN // not valid BCD
    value = value * 100 + hi * 10 + lo
  }
  return value
}

/**
 * Combine 16-bit registers into a value honoring dataType and byteOrder.
 * Single-register types (int8/uint8/int16/uint16/bcd) still honor byte-swap
 * and little-endian (byte order within the register).
 *
 * Modbus conventions used here:
 *   int8/uint8  1 register, low-order byte (Char/Byte)
 *   bcd         1 register, 4 BCD digits
 *   lbcd        2 registers, 8 BCD digits
 *   date        2 registers, Unix seconds (uint32) -> ISO 8601 string
 *   int64/uint64 4 registers; returned as Number (exact up to 2^53)
 */
function combineRegisters(registers, dataType, byteOrder) {
  const bytes = orderBytes(registers, byteOrder)
  const buf = Buffer.from(bytes)
  switch (dataType) {
    case 'int8':
      return buf.readInt8(bytes.length - 1)
    case 'uint8':
      return buf.readUInt8(bytes.length - 1)
    case 'int16':
      return buf.readInt16BE(0)
    case 'uint16':
      return buf.readUInt16BE(0)
    case 'int32':
      return buf.readInt32BE(0)
    case 'uint32':
      return buf.readUInt32BE(0)
    case 'int64':
      return Number(buf.readBigInt64BE(0))
    case 'uint64':
      return Number(buf.readBigUInt64BE(0))
    case 'float32':
      return buf.readFloatBE(0)
    case 'float64':
      return buf.readDoubleBE(0)
    case 'bcd':
    case 'lbcd':
      return decodeBcd(bytes)
    case 'date':
      return new Date(buf.readUInt32BE(0) * 1000).toISOString()
    default:
      return registers[0]
  }
}

/**
 * Inverse of combineRegisters: encode a value as wire-order 16-bit
 * registers honoring dataType and byteOrder. Coils/bools are not handled
 * here (they are plain 0/1 on the wire).
 */
function splitRegisters(value, dataType, byteOrder) {
  let buf
  switch (dataType) {
    case 'int8':
    case 'uint8': {
      buf = Buffer.alloc(2)
      buf.writeUInt8(Number(value) & 0xff, 1) // low-order byte
      break
    }
    case 'int16':
      buf = Buffer.alloc(2)
      buf.writeInt16BE(Number(value), 0)
      break
    case 'uint16':
      buf = Buffer.alloc(2)
      buf.writeUInt16BE(Number(value), 0)
      break
    case 'int32':
      buf = Buffer.alloc(4)
      buf.writeInt32BE(Number(value), 0)
      break
    case 'uint32':
      buf = Buffer.alloc(4)
      buf.writeUInt32BE(Number(value), 0)
      break
    case 'int64':
      buf = Buffer.alloc(8)
      buf.writeBigInt64BE(BigInt(Math.trunc(Number(value))), 0)
      break
    case 'uint64':
      buf = Buffer.alloc(8)
      buf.writeBigUInt64BE(BigInt(Math.trunc(Number(value))), 0)
      break
    case 'float32':
      buf = Buffer.alloc(4)
      buf.writeFloatBE(Number(value), 0)
      break
    case 'float64':
      buf = Buffer.alloc(8)
      buf.writeDoubleBE(Number(value), 0)
      break
    case 'bcd':
    case 'lbcd': {
      const digits = dataType === 'bcd' ? 4 : 8
      const text = String(Math.trunc(Number(value))).padStart(digits, '0').slice(-digits)
      const bytes = []
      for (let i = 0; i < digits; i += 2) {
        bytes.push((Number(text[i]) << 4) | Number(text[i + 1]))
      }
      buf = Buffer.from(bytes)
      break
    }
    case 'date': {
      const ms = typeof value === 'string' ? Date.parse(value) : Number(value)
      buf = Buffer.alloc(4)
      buf.writeUInt32BE(Math.floor(ms / 1000) >>> 0, 0)
      break
    }
    default: {
      buf = Buffer.alloc(2)
      buf.writeUInt16BE(Number(value) & 0xffff, 0)
      break
    }
  }
  const wire = reorderBytes([...buf], byteOrder)
  const registers = []
  for (let i = 0; i < wire.length; i += 2) registers.push((wire[i] << 8) | wire[i + 1])
  return registers
}

module.exports = { orderBytes, combineRegisters, splitRegisters }
