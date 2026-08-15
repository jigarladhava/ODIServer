import type { ByteOrder, DataType } from './types';

/** Industrial display names for tag data types (enum values stay the API values). */
export const DATA_TYPE_LABELS: Record<DataType, string> = {
  bool: 'Boolean',
  int8: 'Char (Int8)',
  uint8: 'Byte (UInt8)',
  int16: 'Int16',
  uint16: 'UInt16',
  int32: 'Int32',
  uint32: 'UInt32',
  int64: 'Int64',
  uint64: 'UInt64',
  float32: 'Float',
  float64: 'Double',
  bcd: 'BCD',
  lbcd: 'Long BCD',
  date: 'Date',
  string: 'String',
};

/** All selectable tag data types, in display order. */
export const DATA_TYPE_OPTIONS = Object.keys(DATA_TYPE_LABELS) as DataType[];

/** Byte/word assembly order for multi-register Modbus values. */
export const BYTE_ORDER_OPTIONS: { value: ByteOrder; label: string }[] = [
  { value: 'big-endian', label: 'Big Endian (ABCD)' },
  { value: 'word-swap', label: 'Word Swap (CDAB)' },
  { value: 'byte-swap', label: 'Byte Swap (BADC)' },
  { value: 'little-endian', label: 'Little Endian (DCBA)' },
];

/** Data types stored in (possibly multiple) Modbus registers — byte order applies to these. */
export function isRegisterDataType(dataType: DataType): boolean {
  switch (dataType) {
    case 'int8':
    case 'uint8':
    case 'int16':
    case 'uint16':
    case 'int32':
    case 'uint32':
    case 'int64':
    case 'uint64':
    case 'float32':
    case 'float64':
    case 'bcd':
    case 'lbcd':
    case 'date':
      return true;
    default:
      return false;
  }
}
