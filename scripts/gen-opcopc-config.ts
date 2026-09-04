/**
 * gen-opcopc-config — build an ODIServer project that mirrors a KEPServerEX
 * project over OPC UA (OPC-to-OPC bridge).
 *
 * Every Kepware channel becomes an opcua-client channel pointing at the
 * KEPServerEX OPC UA endpoint; every Kepware tag becomes a tag whose address
 * is its Kepware OPC UA NodeId (ns=2;s=Channel.Device.Tag). ODIServer then
 * re-exposes the same Channel/Device/Tag tree on its own OPC UA server, so an
 * OPC client sees the identical scheme on both ends.
 *
 * Usage (from the repo root):
 *   npx tsx scripts/gen-opcopc-config.ts [input.json] [output.json] [endpointUrl]
 *
 * Defaults:
 *   input    E:\Downloads\Kep03-06-2026.json
 *   output   odiserver-opcopc-project.json
 *   endpoint opc.tcp://127.0.0.1:49320  (KEPServerEX OPC UA default port)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ProjectSchema } from "@odiserver/core";

const KEP_DATA_TYPES: Record<number, string> = {
  0: "string",
  1: "bool",
  2: "int8",
  3: "uint8",
  4: "int16",
  5: "uint16",
  6: "int32",
  7: "uint32",
  8: "float32",
  9: "float64",
  10: "bcd",
  11: "lbcd",
  12: "date",
  13: "int64",
  14: "uint64",
};

function slugify(name: string): string {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  const id = `${base}-${i}`;
  taken.add(id);
  return id;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface KepTag {
  name: string;
  /** Dot path segments between device and tag (tag groups). */
  groupPath: string[];
  raw: any;
}

function collectTags(device: any): KepTag[] {
  const out: KepTag[] = [];
  for (const tag of device.tags ?? []) out.push({ name: tag["common.ALLTYPES_NAME"] ?? "Tag", groupPath: [], raw: tag });
  const walk = (groups: any[], prefix: string[]): void => {
    for (const group of groups ?? []) {
      const groupName = String(group["common.ALLTYPES_NAME"] ?? "Group");
      for (const tag of group.tags ?? []) {
        out.push({ name: tag["common.ALLTYPES_NAME"] ?? "Tag", groupPath: [...prefix, groupName], raw: tag });
      }
      walk(group.tag_groups, [...prefix, groupName]);
    }
  };
  walk(device.tag_groups, []);
  return out;
}

const input = process.argv[2] ?? "E:\\Downloads\\Kep03-06-2026.json";
const output = process.argv[3] ?? "odiserver-opcopc-project.json";
const endpointUrl = process.argv[4] ?? "opc.tcp://127.0.0.1:49320";
// Optional security overrides (many KEPServerEX installs allow no None endpoint).
const securityPolicy = process.argv[5] ?? "None";
const securityMode = process.argv[6] ?? "None";
const username = process.argv[7];
const password = process.argv[8];
// Transport client cert for Sign/SignAndEncrypt (default: auto-generated
// self-signed cert, which the server must then trust).
const clientCertificateFile = process.argv[9];
const clientPrivateKeyFile = process.argv[10];

const doc = JSON.parse(readFileSync(input, "utf8").replace(/^﻿/, ""));
const kep = doc?.project;
if (!kep || !Array.isArray(kep.channels)) {
  throw new Error("Not a KEPServerEX project export: missing project.channels.");
}

const warnings: string[] = [];
const channels: unknown[] = [];
const devices: unknown[] = [];
const tags: unknown[] = [];
const channelIds = new Set<string>();
const deviceIds = new Set<string>();
const tagIds = new Set<string>();
let skippedEmptyChannels = 0;

for (const kepChannel of kep.channels) {
  const channelName = String(kepChannel["common.ALLTYPES_NAME"] ?? "Channel");
  const sourceDriver = String(kepChannel["servermain.MULTIPLE_TYPES_DEVICE_DRIVER"] ?? "");
  const kepDevices = (kepChannel.devices ?? []).filter((d: any) => collectTags(d).length > 0);
  if (kepDevices.length === 0) {
    skippedEmptyChannels++;
    continue;
  }
  const channelId = uniqueId(slugify(channelName), channelIds);
  channels.push({
    id: channelId,
    name: channelName,
    driver: "opcua-client",
    enabled: true,
    settings: {
      endpointUrl,
      securityPolicy,
      securityMode,
      ...(username ? { authType: "username", username, password: password ?? "" } : {}),
      ...(clientCertificateFile
        ? { clientCertificateFile, clientPrivateKeyFile: clientPrivateKeyFile ?? "" }
        : {}),
      sourceDriver,
    },
  });

  for (const kepDevice of kepDevices) {
    const deviceName = String(kepDevice["common.ALLTYPES_NAME"] ?? "Device");
    const deviceId = uniqueId(`${channelId}.${slugify(deviceName)}`, deviceIds);
    const scanModeCode = Number(kepDevice["servermain.DEVICE_SCAN_MODE"] ?? 0);
    devices.push({
      id: deviceId,
      channelId,
      name: deviceName,
      enabled: kepDevice["servermain.DEVICE_DATA_COLLECTION"] !== false,
      settings: {
        sourceDeviceId: String(kepDevice["servermain.DEVICE_ID_STRING"] ?? ""),
        scanMode: scanModeCode === 0 ? "respect-tag" : "respect-device",
        scanModeRateMs: Number(kepDevice["servermain.DEVICE_SCAN_MODE_RATE_MS"] ?? 1000),
        description: String(kepDevice["common.ALLTYPES_DESCRIPTION"] ?? ""),
      },
    });

    const deviceScanRate = Number(kepDevice["servermain.DEVICE_SCAN_MODE_RATE_MS"] ?? 1000);
    for (const kepTag of collectTags(kepDevice)) {
      const typeCode = Number(kepTag.raw["servermain.TAG_DATA_TYPE"] ?? 5);
      const dataType = KEP_DATA_TYPES[typeCode];
      if (!dataType) {
        warnings.push(
          `Tag "${channelName}.${deviceName}.${kepTag.name}": unknown Kepware data type ${typeCode} — imported as uint16.`,
        );
      }
      // Kepware OPC UA nodeId: ns=2;s=Channel.Device[.Group...].Tag
      const nodePath = [channelName, deviceName, ...kepTag.groupPath, kepTag.name].join(".");
      const scanRate = Number(kepTag.raw["servermain.TAG_SCAN_RATE_MILLISECONDS"] ?? deviceScanRate);
      const scalingType = Number(kepTag.raw["servermain.TAG_SCALING_TYPE"] ?? 0);
      const scaling =
        scalingType === 1 || scalingType === 2
          ? {
              enabled: true,
              type: scalingType === 2 ? "square-root" : "linear",
              rawMin: Number(kepTag.raw["servermain.TAG_SCALING_RAW_LOW"] ?? 0),
              rawMax: Number(kepTag.raw["servermain.TAG_SCALING_RAW_HIGH"] ?? 100),
              engMin: Number(kepTag.raw["servermain.TAG_SCALING_SCALED_LOW"] ?? 0),
              engMax: Number(kepTag.raw["servermain.TAG_SCALING_SCALED_HIGH"] ?? 100),
              clampLow: kepTag.raw["servermain.TAG_SCALING_CLAMP_LOW"] === 1,
              clampHigh: kepTag.raw["servermain.TAG_SCALING_CLAMP_HIGH"] === 1,
              negate: kepTag.raw["servermain.TAG_SCALING_NEGATE"] === 1,
            }
          : undefined;
      tags.push({
        id: uniqueId(`${deviceId}.${slugify(kepTag.name)}`, tagIds),
        deviceId,
        name: kepTag.name,
        address: `ns=2;s=${nodePath}`,
        dataType: dataType ?? "uint16",
        access: Number(kepTag.raw["servermain.TAG_READ_WRITE_ACCESS"] ?? 0) === 1 ? "rw" : "ro",
        scanRateMs: Math.max(50, Number.isFinite(scanRate) ? scanRate : 1000),
        ...(scaling ? { scaling } : {}),
        description: String(kepTag.raw["common.ALLTYPES_DESCRIPTION"] ?? ""),
      });
    }
  }
}

const project = ProjectSchema.parse({ channels, devices, tags, mqttAgents: [] });
writeFileSync(output, JSON.stringify(project, null, 2));

console.log(`Channels: ${project.channels.length} (skipped ${skippedEmptyChannels} with no tags)`);
console.log(`Devices:  ${project.devices.length}`);
console.log(`Tags:     ${project.tags.length}`);
console.log(`Endpoint: ${endpointUrl}`);
for (const w of warnings) console.log(`WARNING: ${w}`);
console.log(`Wrote ${output}`);
