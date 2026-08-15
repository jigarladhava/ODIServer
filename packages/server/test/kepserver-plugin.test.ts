import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface ConvertedProject {
  channels: { id: string; name: string; driver: string }[];
  devices: {
    id: string;
    channelId: string;
    name: string;
    enabled: boolean;
    settings: Record<string, unknown>;
  }[];
  tags: {
    id: string;
    deviceId: string;
    name: string;
    address: string;
    dataType: string;
    byteOrder: string;
    scanRateMs: number;
  }[];
  mqttAgents: {
    id: string;
    name: string;
    enabled: boolean;
    url: string;
    qos: number;
    mode: string;
    intervalMs: number;
    topicPattern: string;
  }[];
}

interface KepPlugin {
  id: string;
  name: string;
  importProject(raw: string): { project: ConvertedProject; warnings: string[] };
}

const here = dirname(fileURLToPath(import.meta.url));
const pluginPath = join(here, "..", "..", "..", "plugins", "kepserver-import", "index.js");

async function loadPlugin(): Promise<KepPlugin> {
  // @ts-ignore plain-JS plugin module, no type declarations
  const mod = await import(pluginPath);
  return mod.default as KepPlugin;
}

function kepTag(name: string, address: string, dataType: number) {
  return {
    "common.ALLTYPES_NAME": name,
    "servermain.TAG_ADDRESS": address,
    "servermain.TAG_DATA_TYPE": dataType,
    "servermain.TAG_READ_WRITE_ACCESS": 0,
    "servermain.TAG_SCAN_RATE_MILLISECONDS": 100,
    "servermain.TAG_SCALING_TYPE": 0,
  };
}

const FIXTURE = JSON.stringify({
  project: {
    channels: [
      {
        "common.ALLTYPES_NAME": "Well Station",
        "servermain.MULTIPLE_TYPES_DEVICE_DRIVER": "Modbus TCP/IP Ethernet",
        devices: [
          {
            "common.ALLTYPES_NAME": "Pump 1",
            "servermain.DEVICE_ID_STRING": "<10.1.2.3>.2",
            "servermain.DEVICE_DATA_COLLECTION": true,
            "servermain.DEVICE_SCAN_MODE_RATE_MS": 1000,
            "modbus_ethernet.DEVICE_ETHERNET_PORT_NUMBER": 502,
            "modbus_ethernet.DEVICE_ZERO_BASED_ADDRESSING": true,
            "modbus_ethernet.DEVICE_FIRST_WORD_LOW": false,
            "modbus_ethernet.DEVICE_FIRST_DWORD_LOW": false,
            tags: [
              kepTag("Flow", "40503", 8), // Float, zero-based -> 40504
              kepTag("Running", "00001", 1), // Boolean coil -> 00002
              kepTag("Counter", "30009", 5), // Word -> 30010
            ],
          },
          {
            "common.ALLTYPES_NAME": "Pump 2",
            "servermain.DEVICE_ID_STRING": "<10.1.2.4>.3",
            "servermain.DEVICE_DATA_COLLECTION": false,
            "modbus_ethernet.DEVICE_ZERO_BASED_ADDRESSING": false,
            "modbus_ethernet.DEVICE_FIRST_WORD_LOW": true,
            "modbus_ethernet.DEVICE_FIRST_DWORD_LOW": true,
            tags: [
              kepTag("Pressure", "40010", 8), // 1-based -> unchanged, word-swap
              kepTag("Energy", "40020", 9), // Double -> little-endian
            ],
            tag_groups: [
              {
                "common.ALLTYPES_NAME": "Group A",
                tags: [kepTag("Grouped", "40030", 7)], // DWord in a tag group
              },
            ],
          },
        ],
      },
      {
        "common.ALLTYPES_NAME": "Modem Ping",
        "servermain.MULTIPLE_TYPES_DEVICE_DRIVER": "Ping",
        devices: [{ "common.ALLTYPES_NAME": "MODEM", tags: [] }],
      },
    ],
    _iot_gateway: [
      {
        "common.ALLTYPES_NAME": "GW",
        mqtt_clients: [
          {
            "common.ALLTYPES_NAME": "MQTT_Test",
            "iot_gateway.AGENTTYPES_TYPE": "MQTT Client",
            "iot_gateway.MQTT_CLIENT_URL": "tcp://10.20.112.107:1883",
            "iot_gateway.MQTT_CLIENT_TOPIC": "iotgateway",
            "iot_gateway.MQTT_CLIENT_QOS": 1,
            "iot_gateway.AGENTTYPES_RATE_MS": 10000,
            "iot_gateway.MQTT_CLIENT_CLIENT_ID": "kepservermqtt",
            "iot_gateway.MQTT_CLIENT_USERNAME": "",
            "iot_gateway.MQTT_CLIENT_PASSWORD": "",
            iot_items: [],
          },
        ],
      },
    ],
  },
});

describe("kepserver-import plugin", () => {
  it("converts channels, devices and tags with the Kepware mapping", async () => {
    const plugin = await loadPlugin();
    const { project, warnings } = plugin.importProject(FIXTURE);

    expect(project.channels).toEqual([
      {
        id: "well-station",
        name: "Well Station",
        driver: "modbus-tcp",
        enabled: true,
        settings: { writeOptimizationMethod: 0, writeDutyCycle: 10 },
      },
    ]);
    expect(warnings.some((w) => w.includes('driver "Ping" is not supported'))).toBe(true);

    const [pump1, pump2] = project.devices;
    expect(pump1.settings).toMatchObject({
      host: "10.1.2.3",
      port: 502,
      unitId: 2,
      requestTimeoutMs: 1000,
      connectTimeoutSec: 3,
      retryAttempts: 3,
      interRequestDelayMs: 0,
      scanMode: "respect-tag",
      scanModeRateMs: 1000,
    });
    expect(pump1.enabled).toBe(true);
    expect(pump2.enabled).toBe(false); // DEVICE_DATA_COLLECTION false

    const byName = new Map(project.tags.map((t) => [t.name, t]));
    // Zero-based device: +1 shift; FIRST_WORD_LOW false -> big-endian.
    expect(byName.get("Flow")).toMatchObject({
      address: "40504",
      dataType: "float32",
      byteOrder: "big-endian",
      scanRateMs: 100,
    });
    expect(byName.get("Running")).toMatchObject({ address: "00002", dataType: "bool" });
    expect(byName.get("Counter")).toMatchObject({ address: "30010", dataType: "uint16" });
    // 1-based device: address unchanged; word/dword low -> swapped orders.
    expect(byName.get("Pressure")).toMatchObject({ address: "40010", byteOrder: "word-swap" });
    expect(byName.get("Energy")).toMatchObject({ dataType: "float64", byteOrder: "little-endian" });
    // Tag groups are flattened.
    expect(byName.get("Grouped")).toMatchObject({ address: "40030", dataType: "uint32" });
    // Tag ids follow the <deviceId>.<slug> convention.
    expect(byName.get("Flow")!.id).toBe("well-station.pump-1.flow");
  });

  it("maps the IoT Gateway MQTT client to a disabled MQTT agent", async () => {
    const plugin = await loadPlugin();
    const { project, warnings } = plugin.importProject(FIXTURE);

    expect(project.mqttAgents).toHaveLength(1);
    expect(project.mqttAgents[0]).toMatchObject({
      name: "MQTT_Test",
      enabled: false,
      url: "mqtt://10.20.112.107:1883",
      qos: 1,
      mode: "interval",
      intervalMs: 10000,
      topicPattern: "iotgateway/{tag}",
    });
    expect(warnings.some((w) => w.includes("MQTT_Test"))).toBe(true);
  });

  it("rejects non-Kepware JSON with a readable error", async () => {
    const plugin = await loadPlugin();
    expect(() => plugin.importProject("{}")).toThrow(/project\.channels/);
    expect(() => plugin.importProject("not json")).toThrow(/Not a valid JSON/);
  });

  it("converts the real Kep_15-08-2026 export", async () => {
    const realFile = join(here, "..", "..", "..", "data", "Kep_15-08-2026.json");
    if (!existsSync(realFile)) return; // repo-local sample not present
    const plugin = await loadPlugin();
    const { project, warnings } = plugin.importProject(readFileSync(realFile, "utf8"));

    expect(project.channels).toHaveLength(124);
    expect(project.devices).toHaveLength(735);
    expect(project.tags).toHaveLength(13201);
    expect(project.mqttAgents).toHaveLength(1);
    // 12 skipped Ping channels + 1 demand-poll scan-mode note + 1 MQTT agent note.
    expect(warnings).toHaveLength(14);
    expect(warnings.some((w) => w.includes("demand poll only"))).toBe(true);
    // Tag ids are globally unique (store PK).
    expect(new Set(project.tags.map((t) => t.id)).size).toBe(project.tags.length);
  });
});
