import { describe, expect, it } from "vitest";
import { TagEngine, applyScaling, coerceToType } from "../src/tag-engine.js";
import type { TagConfig } from "../src/config.js";

function makeTag(overrides: Partial<TagConfig> = {}): TagConfig {
  return {
    id: "t1",
    deviceId: "d1",
    name: "Tag1",
    address: "40001",
    dataType: "float64",
    scanRateMs: 1000,
    deadband: 0,
    scaling: { enabled: false, rawMin: 0, rawMax: 100, engMin: 0, engMax: 100 },
    description: "",
    ...overrides,
  };
}

describe("applyScaling", () => {
  it("returns raw value when disabled", () => {
    expect(applyScaling(50, { enabled: false, rawMin: 0, rawMax: 100, engMin: 0, engMax: 1000 })).toBe(50);
  });

  it("maps linearly when enabled", () => {
    const s = { enabled: true, rawMin: 0, rawMax: 100, engMin: 0, engMax: 1000 };
    expect(applyScaling(0, s)).toBe(0);
    expect(applyScaling(50, s)).toBe(500);
    expect(applyScaling(100, s)).toBe(1000);
  });

  it("handles inverted engineering ranges", () => {
    const s = { enabled: true, rawMin: 0, rawMax: 100, engMin: 100, engMax: 0 };
    expect(applyScaling(0, s)).toBe(100);
    expect(applyScaling(100, s)).toBe(0);
  });

  it("returns engMin on zero raw span (no divide-by-zero)", () => {
    const s = { enabled: true, rawMin: 5, rawMax: 5, engMin: 42, engMax: 100 };
    expect(applyScaling(5, s)).toBe(42);
  });
});

describe("coerceToType", () => {
  it("rounds integer types", () => {
    expect(coerceToType(10.6, "int16")).toBe(11);
    expect(coerceToType(10.4, "uint32")).toBe(10);
  });

  it("applies float32 precision", () => {
    expect(coerceToType(0.1 + 0.2, "float32")).toBe(Math.fround(0.1 + 0.2));
  });
});

describe("TagEngine", () => {
  it("starts tags as bad quality with null value", () => {
    const engine = new TagEngine();
    engine.load([makeTag()]);
    expect(engine.getValue("t1")).toMatchObject({ value: null, quality: "bad" });
  });

  it("emits change on first value", () => {
    const engine = new TagEngine();
    engine.load([makeTag()]);
    const events: unknown[] = [];
    engine.on("change", (e) => events.push(e));
    engine.updateRaw("t1", 12.5);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tagId: "t1", value: 12.5, quality: "good" });
  });

  it("applies scaling then datatype coercion", () => {
    const engine = new TagEngine();
    engine.load([
      makeTag({
        dataType: "int16",
        scaling: { enabled: true, rawMin: 0, rawMax: 100, engMin: 0, engMax: 10 },
      }),
    ]);
    engine.updateRaw("t1", 55); // 5.5 scaled -> rounds to 6
    expect(engine.getValue("t1")?.value).toBe(6);
  });

  it("suppresses changes within deadband", () => {
    const engine = new TagEngine();
    engine.load([makeTag({ deadband: 1.0 })]);
    const events: unknown[] = [];
    engine.on("change", (e) => events.push(e));
    engine.updateRaw("t1", 100);
    engine.updateRaw("t1", 100.5); // within deadband
    engine.updateRaw("t1", 101.5); // beyond deadband from last reported 100
    expect(events).toHaveLength(2);
  });

  it("reports change when quality changes even if value does not", () => {
    const engine = new TagEngine();
    engine.load([makeTag()]);
    const events: { quality: string }[] = [];
    engine.on("change", (e) => events.push(e));
    engine.updateRaw("t1", 10);
    engine.setQuality("t1", "bad");
    engine.setQuality("t1", "bad"); // no-op, same quality
    expect(events).toHaveLength(2);
    expect(events[1].quality).toBe("bad");
  });

  it("stores and clears driver error messages", () => {
    const engine = new TagEngine();
    engine.load([makeTag()]);
    const events: { quality: string; error?: string }[] = [];
    engine.on("change", (e) => events.push(e));

    engine.setQuality("t1", "bad", "Empty response from device");
    expect(engine.getValue("t1")).toMatchObject({
      quality: "bad",
      error: "Empty response from device",
    });

    engine.setQuality("t1", "bad", "Empty response from device"); // same state: no re-emit
    expect(events).toHaveLength(1);

    engine.updateRaw("t1", 10); // success clears the error
    expect(engine.getValue("t1")?.error).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ quality: "good" });
    expect(events.at(-1)?.error).toBeUndefined();
  });

  it("marks all device tags on connection loss", () => {
    const engine = new TagEngine();
    engine.load([makeTag(), makeTag({ id: "t2", deviceId: "d2" })]);
    engine.updateRaw("t1", 5);
    engine.updateRaw("t2", 6);
    engine.setQualityForDevice("d1", "bad", "Device communication: timeout");
    expect(engine.getValue("t1")).toMatchObject({ quality: "bad", error: "Device communication: timeout" });
    expect(engine.getValue("t2")).toMatchObject({ quality: "good" }); // other device untouched
  });

  it("emits write requests for known tags and rejects unknown ones", () => {
    const engine = new TagEngine();
    engine.load([makeTag()]);
    const writes: unknown[] = [];
    engine.on("write", (w) => writes.push(w));
    engine.write("t1", 55);
    expect(writes).toEqual([{ tagId: "t1", value: 55 }]);
    expect(() => engine.write("nope", 1)).toThrow();
  });

  it("ignores raw updates for unknown tags", () => {
    const engine = new TagEngine();
    engine.updateRaw("ghost", 1); // must not throw
    expect(engine.getValue("ghost")).toBeUndefined();
  });
});
