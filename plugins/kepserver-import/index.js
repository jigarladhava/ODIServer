/**
 * kepserver-import — ImporterPlugin for KEPServerEX JSON project exports.
 *
 * Converts a Kepware project export (`{ project: { channels: [...] } }`) into
 * an ODIServer project tree ({ channels, devices, tags, mqttAgents }). Plain
 * ESM JavaScript with no build step; loaded at runtime by the server's plugin
 * loader (packages/server/src/plugins/loader.ts).
 *
 * Mapping notes:
 * - Kepware data types are an integer enum (see KEP_DATA_TYPES).
 * - Kepware devices commonly use zero-based addressing; ODIServer uses the
 *   classic 1-based notation (40001 = offset 0), so zero-based addresses are
 *   shifted by +1.
 * - Per-device word/dword order (DEVICE_FIRST_WORD_LOW / _FIRST_DWORD_LOW)
 *   becomes the tag-level byteOrder.
 * - Channels whose driver has no ODIServer equivalent (e.g. Ping) are skipped
 *   and reported in warnings.
 */

const KEP_DATA_TYPES = {
  0: "string", // String
  1: "bool", // Boolean
  2: "int8", // Char
  3: "uint8", // Byte
  4: "int16", // Short
  5: "uint16", // Word
  6: "int32", // Long
  7: "uint32", // DWord
  8: "float32", // Float
  9: "float64", // Double
  10: "bcd", // BCD
  11: "lbcd", // LBCD
  12: "date", // Date
  13: "int64", // LLong
  14: "uint64", // QWord
};

const KEP_DRIVERS = {
  "Modbus TCP/IP Ethernet": "modbus-tcp",
  "Modbus RTU Serial": "modbus-rtu",
};

/** Number of 16-bit registers per ODIServer data type. */
function registerCount(dataType) {
  switch (dataType) {
    case "int32":
    case "uint32":
    case "float32":
    case "lbcd":
    case "date":
      return 2;
    case "float64":
    case "int64":
    case "uint64":
      return 4;
    default:
      return 1;
  }
}

/** Derive a URL/JSON-safe id from a display name (mirrors the web console). */
function slugify(name) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

/** Make a slug unique against existing ids by appending -2, -3, … */
function uniqueId(base, taken) {
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

/**
 * Convert a Kepware numeric Modbus address to ODIServer's 1-based classic
 * notation. Returns null when the address cannot be represented.
 */
function convertAddress(address, zeroBased) {
  const trimmed = String(address).trim();
  if (!/^\d{5,6}$/.test(trimmed)) return null;
  if (!zeroBased) return trimmed;
  const next = Number.parseInt(trimmed, 10) + 1;
  const converted = String(next).padStart(trimmed.length, "0");
  // Crossing into another table prefix (e.g. 49999 -> 50000) is invalid.
  if (converted[0] !== trimmed[0]) return null;
  return converted;
}

/** Parse "<10.0.40.1>.0" -> { host, unitId }. Returns null on other shapes. */
function parseDeviceIdString(idString) {
  const match = /^<([^>]+)>\.(\d+)$/.exec(String(idString ?? "").trim());
  if (!match) return null;
  return { host: match[1], unitId: Number.parseInt(match[2], 10) };
}

/** Kepware MQTT broker URLs use tcp://ssl://; ODIServer uses mqtt://mqtts://. */
function convertBrokerUrl(url) {
  return String(url)
    .trim()
    .replace(/^tcp:\/\//i, "mqtt://")
    .replace(/^ssl:\/\//i, "mqtts://");
}

function* iterateTags(device) {
  for (const tag of device.tags ?? []) yield tag;
  const walk = function* (groups) {
    for (const group of groups ?? []) {
      for (const tag of group.tags ?? []) yield tag;
      yield* walk(group.tag_groups);
    }
  };
  yield* walk(device.tag_groups);
}

function convertMqttAgents(project, warnings) {
  const agents = [];
  const taken = new Set();
  for (const gateway of project._iot_gateway ?? []) {
    for (const client of gateway.mqtt_clients ?? []) {
      if (client["iot_gateway.AGENTTYPES_TYPE"] !== "MQTT Client") continue;
      const name = client["common.ALLTYPES_NAME"] || "MQTT Client";
      const topic = String(client["iot_gateway.MQTT_CLIENT_TOPIC"] ?? "").replace(/\/+$/, "");
      const qosRaw = Number(client["iot_gateway.MQTT_CLIENT_QOS"] ?? 0);
      agents.push({
        id: uniqueId(slugify(name), taken),
        name,
        // Item selection and message templates are not imported — the agent
        // is created disabled so the user reviews it before going live.
        enabled: false,
        url: convertBrokerUrl(client["iot_gateway.MQTT_CLIENT_URL"] ?? ""),
        clientId: String(client["iot_gateway.MQTT_CLIENT_CLIENT_ID"] ?? ""),
        username: String(client["iot_gateway.MQTT_CLIENT_USERNAME"] ?? "") || undefined,
        password: String(client["iot_gateway.MQTT_CLIENT_PASSWORD"] ?? "") || undefined,
        mode: "interval",
        intervalMs: Math.max(100, Number(client["iot_gateway.AGENTTYPES_RATE_MS"] ?? 5000)),
        qos: [0, 1, 2].includes(qosRaw) ? qosRaw : 0,
        topicPattern: topic ? `${topic}/{tag}` : "iotgateway/{tag}",
      });
      warnings.push(
        `MQTT agent "${name}": imported disabled; IoT Gateway item selection and message templates are not imported.`,
      );
    }
  }
  return agents;
}

function importProject(raw) {
  const warnings = [];
  let doc;
  try {
    doc = JSON.parse(String(raw).replace(/^﻿/, ""));
  } catch {
    throw new Error("Not a valid JSON file — select a KEPServerEX project export (.json).");
  }
  const kep = doc?.project;
  if (!kep || !Array.isArray(kep.channels)) {
    throw new Error("Not a KEPServerEX project export: missing project.channels.");
  }

  const channels = [];
  const devices = [];
  const tags = [];
  const channelIds = new Set();
  const deviceIds = new Set();
  const tagIds = new Set();

  for (const kepChannel of kep.channels) {
    const channelName = kepChannel["common.ALLTYPES_NAME"] ?? "Channel";
    const driverName = kepChannel["servermain.MULTIPLE_TYPES_DEVICE_DRIVER"];
    const driver = KEP_DRIVERS[driverName];
    if (!driver) {
      const devCount = (kepChannel.devices ?? []).length;
      warnings.push(
        `Channel "${channelName}": driver "${driverName}" is not supported — skipped (${devCount} device(s)).`,
      );
      continue;
    }
    const channelId = uniqueId(slugify(channelName), channelIds);
    channels.push({
      id: channelId,
      name: channelName,
      driver,
      enabled: true,
      settings: {
        // Write optimization: 0 = write all values, 1 = write latest value
        // for non-boolean tags, 2 = write latest value for all tags.
        writeOptimizationMethod: Number(
          kepChannel["servermain.CHANNEL_WRITE_OPTIMIZATIONS_METHOD"] ?? 0,
        ),
        writeDutyCycle: Number(kepChannel["servermain.CHANNEL_WRITE_OPTIMIZATIONS_DUTY_CYCLE"] ?? 10),
      },
    });

    for (const kepDevice of kepChannel.devices ?? []) {
      const deviceName = kepDevice["common.ALLTYPES_NAME"] ?? "Device";
      const deviceId = uniqueId(`${channelId}.${slugify(deviceName)}`, deviceIds);

      const endpoint = parseDeviceIdString(kepDevice["servermain.DEVICE_ID_STRING"]);
      if (!endpoint) {
        warnings.push(
          `Device "${channelName}.${deviceName}": cannot parse DEVICE_ID_STRING "${kepDevice["servermain.DEVICE_ID_STRING"]}" — using host 127.0.0.1, unit 1.`,
        );
      }
      const port = Number(kepDevice["modbus_ethernet.DEVICE_ETHERNET_PORT_NUMBER"] ?? 502);
      const scanModeCode = Number(kepDevice["servermain.DEVICE_SCAN_MODE"] ?? 0);
      if (scanModeCode === 2) {
        warnings.push(
          `Device "${channelName}.${deviceName}": Kepware "demand poll only" scan mode is not supported — polling at the device scan rate instead.`,
        );
      }
      // Kepware block sizes are per table; ODIServer uses one limit per
      // device, so the most restrictive (smallest) configured size wins.
      const blockSizes = [
        kepDevice["modbus_ethernet.DEVICE_OUTPUT_COILS"],
        kepDevice["modbus_ethernet.DEVICE_INPUT_COILS"],
        kepDevice["modbus_ethernet.DEVICE_INTERNAL_REGISTERS"],
        kepDevice["modbus_ethernet.DEVICE_HOLDING_REGISTERS"],
      ]
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      devices.push({
        id: deviceId,
        channelId,
        name: deviceName,
        enabled: kepDevice["servermain.DEVICE_DATA_COLLECTION"] !== false,
        settings: {
          host: endpoint?.host ?? "127.0.0.1",
          port: Number.isFinite(port) ? port : 502,
          unitId: endpoint?.unitId ?? 1,
          requestTimeoutMs: Number(kepDevice["servermain.DEVICE_REQUEST_TIMEOUT_MILLISECONDS"] ?? 1000),
          connectTimeoutSec: Number(kepDevice["servermain.DEVICE_CONNECTION_TIMEOUT_SECONDS"] ?? 3),
          retryAttempts: Number(kepDevice["servermain.DEVICE_RETRY_ATTEMPTS"] ?? 3),
          interRequestDelayMs: Number(
            kepDevice["servermain.DEVICE_INTER_REQUEST_DELAY_MILLISECONDS"] ?? 0,
          ),
          scanMode: scanModeCode === 0 ? "respect-tag" : "respect-device",
          scanModeRateMs: Number(kepDevice["servermain.DEVICE_SCAN_MODE_RATE_MS"] ?? 1000),
          ...(blockSizes.length > 0 ? { maxBlockSize: Math.min(...blockSizes) } : {}),
          useFc05Fc06: kepDevice["modbus_ethernet.DEVICE_MODBUS_FUNCTION_05/06"] !== false,
          bitMaskWrites:
            kepDevice["modbus_ethernet.DEVICE_HOLDING_REGISTER_BIT_MASK_WRITES"] !== false,
        },
      });

      const zeroBased = kepDevice["modbus_ethernet.DEVICE_ZERO_BASED_ADDRESSING"] !== false;
      const firstWordLow = kepDevice["modbus_ethernet.DEVICE_FIRST_WORD_LOW"] !== false;
      const firstDwordLow = kepDevice["modbus_ethernet.DEVICE_FIRST_DWORD_LOW"] !== false;
      const deviceScanRate = Number(kepDevice["servermain.DEVICE_SCAN_MODE_RATE_MS"] ?? 1000);

      for (const kepTag of iterateTags(kepDevice)) {
        const tagName = kepTag["common.ALLTYPES_NAME"] ?? "Tag";
        const address = convertAddress(kepTag["servermain.TAG_ADDRESS"], zeroBased);
        if (!address) {
          warnings.push(
            `Tag "${channelName}.${deviceName}.${tagName}": address "${kepTag["servermain.TAG_ADDRESS"]}" is not a classic Modbus address — skipped.`,
          );
          continue;
        }
        const typeCode = Number(kepTag["servermain.TAG_DATA_TYPE"] ?? 5);
        const dataType = KEP_DATA_TYPES[typeCode];
        if (!dataType) {
          warnings.push(
            `Tag "${channelName}.${deviceName}.${tagName}": unknown Kepware data type ${typeCode} — imported as uint16.`,
          );
        }
        const resolvedType = dataType ?? "uint16";
        const regs = registerCount(resolvedType);
        const byteOrder =
          regs === 4 ? (firstDwordLow ? "little-endian" : "big-endian")
          : regs === 2 ? (firstWordLow ? "word-swap" : "big-endian")
          : "big-endian";
        const scanRate = Number(kepTag["servermain.TAG_SCAN_RATE_MILLISECONDS"] ?? deviceScanRate);
        // Scaling: 0 = none, 1 = linear, 2 = square root.
        const scalingType = Number(kepTag["servermain.TAG_SCALING_TYPE"] ?? 0);
        const scaling =
          scalingType === 1 || scalingType === 2
            ? {
                enabled: true,
                type: scalingType === 2 ? "square-root" : "linear",
                rawMin: Number(kepTag["servermain.TAG_SCALING_RAW_LOW"] ?? 0),
                rawMax: Number(kepTag["servermain.TAG_SCALING_RAW_HIGH"] ?? 100),
                engMin: Number(kepTag["servermain.TAG_SCALING_SCALED_LOW"] ?? 0),
                engMax: Number(kepTag["servermain.TAG_SCALING_SCALED_HIGH"] ?? 100),
                clampLow: kepTag["servermain.TAG_SCALING_CLAMP_LOW"] === 1,
                clampHigh: kepTag["servermain.TAG_SCALING_CLAMP_HIGH"] === 1,
                negate: kepTag["servermain.TAG_SCALING_NEGATE"] === 1,
              }
            : undefined;
        tags.push({
          id: uniqueId(`${deviceId}.${slugify(tagName)}`, tagIds),
          deviceId,
          name: tagName,
          address,
          dataType: resolvedType,
          byteOrder,
          access: Number(kepTag["servermain.TAG_READ_WRITE_ACCESS"] ?? 0) === 1 ? "rw" : "ro",
          scanRateMs: Math.max(50, Number.isFinite(scanRate) ? scanRate : 1000),
          ...(scaling ? { scaling } : {}),
          description: String(kepTag["common.ALLTYPES_DESCRIPTION"] ?? ""),
        });
      }
    }
  }

  const mqttAgents = convertMqttAgents(kep, warnings);
  return { project: { channels, devices, tags, mqttAgents }, warnings };
}

export default {
  id: "kepserver-import",
  name: "KEPServerEX Project (JSON)",
  fileExtensions: [".json"],
  importProject,
};
