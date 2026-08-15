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
  2: "string", // Char
  3: "string", // Byte
  4: "int16", // Short
  5: "uint16", // Word
  6: "int32", // Long
  7: "uint32", // DWord
  8: "float32", // Float
  9: "float64", // Double
  13: "float64", // LLong (no int64 in ODIServer; lossy)
  14: "float64", // QWord (no uint64 in ODIServer; lossy)
};

const KEP_DRIVERS = {
  "Modbus TCP/IP Ethernet": "modbus-tcp",
  "Modbus RTU Serial": "modbus-rtu",
};

/** Number of 16-bit registers per ODIServer data type. */
function registerCount(dataType) {
  if (dataType === "int32" || dataType === "uint32" || dataType === "float32") return 2;
  if (dataType === "float64") return 4;
  return 1;
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
    channels.push({ id: channelId, name: channelName, driver, enabled: true, settings: {} });

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
      devices.push({
        id: deviceId,
        channelId,
        name: deviceName,
        enabled: kepDevice["servermain.DEVICE_DATA_COLLECTION"] !== false,
        settings: {
          host: endpoint?.host ?? "127.0.0.1",
          port: Number.isFinite(port) ? port : 502,
          unitId: endpoint?.unitId ?? 1,
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
        tags.push({
          id: uniqueId(`${deviceId}.${slugify(tagName)}`, tagIds),
          deviceId,
          name: tagName,
          address,
          dataType: resolvedType,
          byteOrder,
          scanRateMs: Math.max(50, Number.isFinite(scanRate) ? scanRate : 1000),
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
