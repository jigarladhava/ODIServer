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

/** Registers (big-endian wire order) -> reordered byte array per byteOrder. */
function orderBytes(registers, byteOrder) {
  const bytes = []
  for (const reg of registers) {
    bytes.push((reg >> 8) & 0xff, reg & 0xff)
  }
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
      return bytes.reverse()
    case 'big-endian':
    default:
      return bytes
  }
}

/**
 * Combine 16-bit registers into a numeric value honoring dataType and
 * byteOrder. Single-register types (int16/uint16) still honor byte-swap
 * and little-endian (byte order within the register).
 */
function combineRegisters(registers, dataType, byteOrder) {
  const bytes = orderBytes(registers, byteOrder)
  const buf = Buffer.from(bytes)
  switch (dataType) {
    case 'int16':
      return buf.readInt16BE(0)
    case 'uint16':
      return buf.readUInt16BE(0)
    case 'int32':
      return buf.readInt32BE(0)
    case 'uint32':
      return buf.readUInt32BE(0)
    case 'float32':
      return buf.readFloatBE(0)
    case 'float64':
      return buf.readDoubleBE(0)
    default:
      return registers[0]
  }
}

module.exports = { orderBytes, combineRegisters }
