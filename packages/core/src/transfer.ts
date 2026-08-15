import { z } from "zod";
import {
  DeviceSchema,
  ProjectSchema,
  TagSchema,
  type DeviceConfig,
  type ProjectConfig,
  type TagConfig,
} from "./config.js";
import { BYTE_ORDERS, DATA_TYPES } from "./types.js";

/**
 * Import/export transfer formats.
 *
 * - Project: the existing ProjectSchema JSON tree (channels + devices + tags).
 * - Device: a device plus its tags, portable across channels/servers.
 * - Tags: CSV (one tag per row) or a JSON array.
 */

/** Portable device bundle: the device config plus all of its tags. */
export const DeviceExportSchema = z.object({
  format: z.literal("odiserver-device").default("odiserver-device"),
  version: z.literal(1).default(1),
  device: DeviceSchema,
  tags: z.array(TagSchema).default([]),
});
export type DeviceExport = z.infer<typeof DeviceExportSchema>;

export function buildDeviceExport(device: DeviceConfig, tags: TagConfig[]): DeviceExport {
  return { format: "odiserver-device", version: 1, device, tags };
}

/** Validate an unknown payload as a full project tree. Throws ZodError. */
export function parseProject(data: unknown): ProjectConfig {
  return ProjectSchema.parse(data);
}

/** Validate an unknown payload as a device export bundle. Throws ZodError. */
export function parseDeviceExport(data: unknown): DeviceExport {
  return DeviceExportSchema.parse(data);
}

// ---------------------------------------------------------------------------
// Tag CSV (one tag per row)
// ---------------------------------------------------------------------------

/**
 * CSV column order for tag import/export. `scaling` is flattened to the
 * five scaling columns; `byteOrder` is included for Modbus multi-register
 * values. Unknown/missing columns fall back to schema defaults.
 */
export const TAG_CSV_COLUMNS = [
  "id",
  "name",
  "address",
  "dataType",
  "byteOrder",
  "access",
  "scanRateMs",
  "deadband",
  "scaling.enabled",
  "scaling.type",
  "scaling.rawMin",
  "scaling.rawMax",
  "scaling.engMin",
  "scaling.engMax",
  "scaling.clampLow",
  "scaling.clampHigh",
  "scaling.negate",
  "description",
] as const;

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize tags to CSV (header row + one row per tag). */
export function tagsToCsv(tags: TagConfig[]): string {
  const lines = [TAG_CSV_COLUMNS.join(",")];
  for (const tag of tags) {
    lines.push(
      [
        csvEscape(tag.id),
        csvEscape(tag.name),
        csvEscape(tag.address),
        tag.dataType,
        tag.byteOrder,
        tag.access,
        String(tag.scanRateMs),
        String(tag.deadband),
        tag.scaling.enabled ? "true" : "false",
        tag.scaling.type,
        String(tag.scaling.rawMin),
        String(tag.scaling.rawMax),
        String(tag.scaling.engMin),
        String(tag.scaling.engMax),
        tag.scaling.clampLow ? "true" : "false",
        tag.scaling.clampHigh ? "true" : "false",
        tag.scaling.negate ? "true" : "false",
        csvEscape(tag.description),
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** Minimal RFC-4180 CSV row parser (handles quoted fields and CRLF). */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      pushField();
      i += 1;
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      pushRow();
      i += 1;
    } else if (ch === "\n") {
      pushRow();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  // Last row (only if there is pending content)
  if (field.length > 0 || row.length > 0) pushRow();
  // Drop fully-empty rows
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const DATA_TYPE_SET = new Set<string>(DATA_TYPES);
const BYTE_ORDER_SET = new Set<string>(BYTE_ORDERS);

function parseNumberCell(raw: string | undefined, fallback: number, column: string, line: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Line ${line}: "${raw}" is not a valid number for ${column}`);
  }
  return n;
}

/**
 * Parse tag CSV into TagConfig objects bound to `deviceId`. IDs are
 * generated as `<deviceId>/<name>` slugs unless an `id` column is present.
 * Throws on the first invalid row with a line-numbered message.
 */
export function csvToTags(text: string, deviceId: string): TagConfig[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const nameIdx = header.indexOf("name");
  const addressIdx = header.indexOf("address");
  if (nameIdx === -1 || addressIdx === -1) {
    throw new Error('CSV header must include at least "name" and "address" columns');
  }
  const col = (row: string[], name: string): string | undefined => {
    const idx = header.indexOf(name);
    return idx === -1 ? undefined : row[idx];
  };

  const tags: TagConfig[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const line = r + 1;
    const name = row[nameIdx]?.trim();
    const address = row[addressIdx]?.trim();
    if (!name) throw new Error(`Line ${line}: tag name is required`);
    if (!address) throw new Error(`Line ${line}: address is required for tag "${name}"`);

    const dataTypeRaw = (col(row, "dataType") ?? "").trim() || "uint16";
    if (!DATA_TYPE_SET.has(dataTypeRaw)) {
      throw new Error(`Line ${line}: unknown dataType "${dataTypeRaw}" for tag "${name}"`);
    }
    const byteOrderRaw = (col(row, "byteOrder") ?? "").trim() || "big-endian";
    if (!BYTE_ORDER_SET.has(byteOrderRaw)) {
      throw new Error(`Line ${line}: unknown byteOrder "${byteOrderRaw}" for tag "${name}"`);
    }
    const scalingEnabledRaw = (col(row, "scaling.enabled") ?? "").trim().toLowerCase();
    const boolCell = (raw: string | undefined) => {
      const v = (raw ?? "").trim().toLowerCase();
      return v === "true" || v === "1" || v === "yes";
    };
    const accessRaw = (col(row, "access") ?? "").trim() || "rw";
    if (accessRaw !== "ro" && accessRaw !== "rw") {
      throw new Error(`Line ${line}: unknown access "${accessRaw}" for tag "${name}" (ro|rw)`);
    }
    const scalingTypeRaw = (col(row, "scaling.type") ?? "").trim() || "linear";
    if (scalingTypeRaw !== "linear" && scalingTypeRaw !== "square-root") {
      throw new Error(`Line ${line}: unknown scaling.type "${scalingTypeRaw}" for tag "${name}"`);
    }

    const idRaw = col(row, "id")?.trim();
    const tag: TagConfig = TagSchema.parse({
      id: idRaw || `${deviceId}.${slugifyName(name)}`,
      deviceId,
      name,
      address,
      dataType: dataTypeRaw,
      byteOrder: byteOrderRaw,
      access: accessRaw,
      scanRateMs: parseNumberCell(col(row, "scanRateMs"), 1000, "scanRateMs", line),
      deadband: parseNumberCell(col(row, "deadband"), 0, "deadband", line),
      scaling: {
        enabled: boolCell(col(row, "scaling.enabled")),
        type: scalingTypeRaw,
        rawMin: parseNumberCell(col(row, "scaling.rawMin"), 0, "scaling.rawMin", line),
        rawMax: parseNumberCell(col(row, "scaling.rawMax"), 100, "scaling.rawMax", line),
        engMin: parseNumberCell(col(row, "scaling.engMin"), 0, "scaling.engMin", line),
        engMax: parseNumberCell(col(row, "scaling.engMax"), 100, "scaling.engMax", line),
        clampLow: boolCell(col(row, "scaling.clampLow")),
        clampHigh: boolCell(col(row, "scaling.clampHigh")),
        negate: boolCell(col(row, "scaling.negate")),
      },
      description: col(row, "description") ?? "",
    });
    tags.push(tag);
  }
  return tags;
}

function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "tag";
}

/**
 * Rebind imported tags to the target device, resolving ID collisions so an
 * import copies tags instead of moving them. Tag IDs live in one global
 * namespace (upsertTag keys on `id` alone), so a tag exported from device A
 * and imported into device B would otherwise be *moved* to B.
 *
 * An ID is kept only when it already belongs to the target device — that
 * makes re-importing a file back into the same device an in-place update
 * (round-trip safe). Any other collision — an ID owned by another device,
 * or one already claimed by an earlier row in the same import — gets a
 * fresh `<deviceId>.<slug>` ID with a numeric suffix if needed.
 */
export function rebindImportedTags(
  tags: TagConfig[],
  deviceId: string,
  existing: (id: string) => TagConfig | undefined,
): TagConfig[] {
  const taken = new Set<string>();
  const usable = (id: string): boolean => {
    if (taken.has(id)) return false;
    const current = existing(id);
    return current === undefined || current.deviceId === deviceId;
  };
  return tags.map((tag) => {
    let id = tag.id;
    if (!usable(id)) {
      const base = `${deviceId}.${slugifyName(tag.name)}`;
      id = base;
      for (let n = 2; !usable(id); n++) id = `${base}-${n}`;
    }
    taken.add(id);
    return { ...tag, id, deviceId };
  });
}
