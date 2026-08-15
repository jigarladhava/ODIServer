import { combineRegisters, orderBytes, splitRegisters } from "../nodered/byte-order.js";
import { describe, expect, it } from "vitest";

// Reference 32-bit value 0x41424344 across two registers:
//   big-endian wire order -> registers [0x4142, 0x4344]
const REGS = [0x4142, 0x4344];

describe("orderBytes", () => {
  it("big-endian keeps wire order", () => {
    expect(orderBytes(REGS, "big-endian")).toEqual([0x41, 0x42, 0x43, 0x44]);
  });
  it("word-swap reverses 16-bit words", () => {
    expect(orderBytes(REGS, "word-swap")).toEqual([0x43, 0x44, 0x41, 0x42]);
  });
  it("byte-swap swaps bytes within each word", () => {
    expect(orderBytes(REGS, "byte-swap")).toEqual([0x42, 0x41, 0x44, 0x43]);
  });
  it("little-endian fully reverses bytes", () => {
    expect(orderBytes(REGS, "little-endian")).toEqual([0x44, 0x43, 0x42, 0x41]);
  });
  it("defaults to big-endian for unknown/undefined order", () => {
    expect(orderBytes(REGS, undefined)).toEqual([0x41, 0x42, 0x43, 0x44]);
  });
});

describe("combineRegisters", () => {
  it("decodes uint32 big-endian", () => {
    expect(combineRegisters(REGS, "uint32", "big-endian")).toBe(0x41424344);
  });

  it("decodes uint32 word-swapped", () => {
    // device sent CD AB: wire registers [0x4344, 0x4142] -> value 0x41424344
    expect(combineRegisters([0x4344, 0x4142], "uint32", "word-swap")).toBe(0x41424344);
  });

  it("decodes uint32 little-endian", () => {
    // device sent DC BA: wire registers [0x4443, 0x4241] -> value 0x41424344
    expect(combineRegisters([0x4443, 0x4241], "uint32", "little-endian")).toBe(0x41424344);
  });

  it("decodes float32 big-endian (1.0 = 0x3F800000)", () => {
    expect(combineRegisters([0x3f80, 0x0000], "float32", "big-endian")).toBe(1.0);
  });

  it("decodes float32 word-swapped", () => {
    expect(combineRegisters([0x0000, 0x3f80], "float32", "word-swap")).toBe(1.0);
  });

  it("decodes float64 big-endian (1.0 = 0x3FF0000000000000)", () => {
    expect(combineRegisters([0x3ff0, 0, 0, 0], "float64", "big-endian")).toBe(1.0);
  });

  it("decodes float64 little-endian", () => {
    // 1.0 = 0x3FF0000000000000 -> DC BA wire bytes 00 00 00 00 00 00 F0 3F
    expect(combineRegisters([0, 0, 0, 0xf03f], "float64", "little-endian")).toBe(1.0);
  });

  it("honors byte order within single-register types", () => {
    expect(combineRegisters([0x1234], "uint16", "big-endian")).toBe(0x1234);
    expect(combineRegisters([0x1234], "uint16", "byte-swap")).toBe(0x3412);
    expect(combineRegisters([0x8000], "int16", "big-endian")).toBe(-32768);
  });

  it("decodes the derived types", () => {
    expect(combineRegisters([0x00ff], "int8", "big-endian")).toBe(-1); // low byte
    expect(combineRegisters([0x00ff], "uint8", "big-endian")).toBe(255);
    expect(combineRegisters([0x1234], "bcd", "big-endian")).toBe(1234);
    expect(combineRegisters([0x1234, 0x5678], "lbcd", "big-endian")).toBe(12345678);
    expect(combineRegisters([0, 1, 0, 0], "uint64", "big-endian")).toBe(0x100000000);
    expect(combineRegisters([0, 60], "date", "big-endian")).toBe(
      new Date(60 * 1000).toISOString(),
    );
    expect(Number.isNaN(combineRegisters([0x1a34], "bcd", "big-endian"))).toBe(true);
  });
});

describe("splitRegisters", () => {
  it("round-trips uint32 across all byte orders", () => {
    for (const order of ["big-endian", "word-swap", "byte-swap", "little-endian"]) {
      const regs = splitRegisters(0x41424344, "uint32", order);
      expect(regs).toHaveLength(2);
      expect(combineRegisters(regs, "uint32", order)).toBe(0x41424344);
    }
  });

  it("encodes float32 word-swapped", () => {
    const regs = splitRegisters(1.0, "float32", "word-swap");
    expect(regs).toEqual([0x0000, 0x3f80]);
  });

  it("round-trips bcd, int64 and date", () => {
    expect(combineRegisters(splitRegisters(1234, "bcd", "big-endian"), "bcd", "big-endian")).toBe(1234);
    expect(
      combineRegisters(splitRegisters(0x100000000, "int64", "big-endian"), "int64", "big-endian"),
    ).toBe(0x100000000);
    const iso = "2026-08-16T00:00:00.000Z";
    expect(combineRegisters(splitRegisters(iso, "date", "big-endian"), "date", "big-endian")).toBe(iso);
  });
});
