import { EventEmitter } from "node:events";
import type { TagConfig } from "./config.js";
import type { Quality, TagPrimitive, TagValue } from "./types.js";

export interface TagChangeEvent extends TagValue {
  tagId: string;
}

export interface TagWriteRequest {
  tagId: string;
  value: TagPrimitive;
}

export interface TagEngineEvents {
  /** Emitted when a tag's reported value or quality changes (post scaling/deadband). */
  change: (event: TagChangeEvent) => void;
  /** Emitted when a client requests a write to a tag. Drivers listen and perform device I/O. */
  write: (request: TagWriteRequest) => void;
}

export declare interface TagEngine {
  on<E extends keyof TagEngineEvents>(event: E, listener: TagEngineEvents[E]): this;
  emit<E extends keyof TagEngineEvents>(event: E, ...args: Parameters<TagEngineEvents[E]>): boolean;
}

interface RuntimeTag {
  config: TagConfig;
  current: TagValue;
  /** Last value/quality actually reported to subscribers (deadband reference). */
  reportedValue: TagPrimitive | null;
  reportedQuality: Quality;
}

/**
 * In-memory tag engine. Holds the live value of every configured tag,
 * applies scaling and deadband, stamps quality/timestamp, and emits
 * change events consumed by northbound interfaces (OPC UA, MQTT, WS).
 *
 * Drivers call updateRaw() with device values; clients call write() to
 * push values down to devices.
 */
export class TagEngine extends EventEmitter {
  private tags = new Map<string, RuntimeTag>();
  /** deviceId -> its tag ids, so device-wide quality marks are O(device tags). */
  private byDevice = new Map<string, Set<string>>();

  constructor() {
    super();
    // Driver write bridges subscribe per tag — hundreds of listeners are normal.
    this.setMaxListeners(0);
  }

  private index(config: TagConfig): void {
    let set = this.byDevice.get(config.deviceId);
    if (!set) {
      set = new Set();
      this.byDevice.set(config.deviceId, set);
    }
    set.add(config.id);
  }

  private unindex(tagId: string, deviceId: string): void {
    const set = this.byDevice.get(deviceId);
    if (!set) return;
    set.delete(tagId);
    if (set.size === 0) this.byDevice.delete(deviceId);
  }

  /** Load/replace the full tag set (e.g. after config load). Existing values are kept by id. */
  load(configs: TagConfig[]): void {
    const next = new Map<string, RuntimeTag>();
    this.byDevice.clear();
    for (const config of configs) {
      const existing = this.tags.get(config.id);
      next.set(config.id, {
        config,
        current: existing?.current ?? {
          value: null,
          quality: "bad" as Quality, // no data yet
          timestamp: Date.now(),
        },
        reportedValue: existing?.reportedValue ?? null,
        reportedQuality: existing?.reportedQuality ?? ("bad" as Quality),
      });
      this.index(config);
    }
    this.tags = next;
  }

  upsertTag(config: TagConfig): void {
    this.load([...this.getConfigs().filter((c) => c.id !== config.id), config]);
  }

  removeTag(tagId: string): void {
    const tag = this.tags.get(tagId);
    if (tag) this.unindex(tagId, tag.config.deviceId);
    this.tags.delete(tagId);
  }

  getConfigs(): TagConfig[] {
    return [...this.tags.values()].map((t) => t.config);
  }

  getConfig(tagId: string): TagConfig | undefined {
    return this.tags.get(tagId)?.config;
  }

  getValue(tagId: string): TagValue | undefined {
    return this.tags.get(tagId)?.current;
  }

  getAllValues(): Record<string, TagValue> {
    const out: Record<string, TagValue> = {};
    for (const [id, t] of this.tags) out[id] = t.current;
    return out;
  }

  /**
   * Ingest a raw device value. Applies scaling and datatype coercion,
   * then emits `change` if the value moved beyond the deadband or the
   * quality changed. A successful update clears any stored error.
   */
  updateRaw(tagId: string, raw: TagPrimitive | null, quality: Quality = "good"): void {
    const tag = this.tags.get(tagId);
    if (!tag) return;

    const value = raw === null ? null : this.processValue(tag.config, raw);
    const now = Date.now();

    // Deadband is measured against the last *reported* value, not the last
    // received one — otherwise slow drift would never be reported.
    const qualityChanged = tag.reportedQuality !== quality;
    const valueChanged = !this.withinDeadband(tag.config, tag.reportedValue, value);
    const errorCleared = tag.current.error !== undefined;

    tag.current = { value, quality, timestamp: now };

    if (qualityChanged || valueChanged || errorCleared) {
      tag.reportedValue = value;
      tag.reportedQuality = quality;
      this.emit("change", { tagId, value, quality, timestamp: now });
    }
  }

  /** Mark a tag's quality without touching its value (e.g. device comm failure). */
  setQuality(tagId: string, quality: Quality, error?: string): void {
    const tag = this.tags.get(tagId);
    if (!tag) return;
    if (tag.reportedQuality === quality && tag.current.error === error) return;
    const now = Date.now();
    tag.current = { ...tag.current, quality, timestamp: now, error };
    tag.reportedQuality = quality;
    tag.reportedValue = tag.current.value;
    this.emit("change", { tagId, value: tag.current.value, quality, timestamp: now, error });
  }

  /** Mark every tag of a device (e.g. connection lost) — classic device-down behavior. */
  setQualityForDevice(deviceId: string, quality: Quality, error?: string): void {
    const ids = this.byDevice.get(deviceId);
    if (!ids) return;
    for (const tagId of ids) this.setQuality(tagId, quality, error);
  }

  /** Client-initiated write. The driver layer performs the device I/O and confirms via updateRaw(). */
  write(tagId: string, value: TagPrimitive): void {
    const tag = this.tags.get(tagId);
    if (!tag) throw new Error(`Unknown tag: ${tagId}`);
    if (tag.config.access === "ro") throw new Error(`Tag is read-only: ${tagId}`);
    this.emit("write", { tagId, value });
  }

  private processValue(config: TagConfig, raw: TagPrimitive): TagPrimitive {
    if (typeof raw !== "number") return raw;
    const scaled = applyScaling(raw, config.scaling);
    return coerceToType(scaled, config.dataType);
  }

  private withinDeadband(
    config: TagConfig,
    prev: TagPrimitive | null,
    next: TagPrimitive | null,
  ): boolean {
    if (prev === null || next === null) return prev === next;
    if (typeof prev === "number" && typeof next === "number") {
      return Math.abs(next - prev) <= config.deadband;
    }
    return prev === next;
  }
}

export function applyScaling(raw: number, scaling: TagConfig["scaling"]): number {
  if (!scaling.enabled) return raw;
  const span = scaling.rawMax - scaling.rawMin;
  if (span === 0) return scaling.engMin;
  const ratio = (raw - scaling.rawMin) / span;
  const fraction = scaling.type === "square-root" ? Math.sqrt(Math.max(0, ratio)) : ratio;
  let value = scaling.engMin + fraction * (scaling.engMax - scaling.engMin);
  if (scaling.clampLow) value = Math.max(value, scaling.engMin);
  if (scaling.clampHigh) value = Math.min(value, scaling.engMax);
  if (scaling.negate) value = -value;
  return value;
}

export function coerceToType(value: number, dataType: TagConfig["dataType"]): number {
  switch (dataType) {
    case "int8":
    case "uint8":
    case "int16":
    case "uint16":
    case "int32":
    case "uint32":
    case "bcd":
    case "lbcd":
      return Math.round(value);
    case "int64":
    case "uint64":
      // JS numbers hold integers exactly only up to 2^53; values beyond
      // that lose precision (documented limitation of the number pipeline).
      return Math.round(value);
    case "float32":
      return Math.fround(value);
    case "float64":
    default:
      return value;
  }
}
