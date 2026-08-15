import { join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  AccessLevelFlag,
  DataType,
  DataValue,
  OPCUACertificateManager,
  OPCUAServer,
  StatusCodes,
  Variant,
  type StatusCode,
  type UAObject,
  type UAVariable,
} from "node-opcua";
import type { Logger } from "pino";
import type {
  ConfigStore,
  Quality,
  TagConfig,
  TagEngine,
  TagPrimitive,
} from "@odiserver/core";

/**
 * Northbound OPC UA server: exposes the project's devices and tags as a
 * browsable address space:
 *
 *   Objects
 *     └── Devices
 *           └── <device name>            (object, nodeId s=device:<deviceId>)
 *                 └── <tag name>         (variable, nodeId s=<tagId>)
 *
 * Reads are served from the tag engine (value, quality and source timestamp
 * included); writes go through `engine.write()` down to the driver layer.
 * The address space is rebuilt (debounced) whenever the config store changes.
 */

export interface OpcUaServerOptions {
  engine: TagEngine;
  store: ConfigStore;
  port: number;
  serverName?: string;
  /** Directory for the auto-generated server certificate. */
  certsDir: string;
  logger?: Logger;
}

export interface OpcUaServerHandle {
  port: number;
  endpointUrl: string;
  stop(): Promise<void>;
}

const OPCUA_DATA_TYPE: Record<TagConfig["dataType"], DataType> = {
  bool: DataType.Boolean,
  int8: DataType.SByte,
  uint8: DataType.Byte,
  int16: DataType.Int16,
  uint16: DataType.UInt16,
  int32: DataType.Int32,
  uint32: DataType.UInt32,
  int64: DataType.Int64,
  uint64: DataType.UInt64,
  float32: DataType.Float,
  float64: DataType.Double,
  bcd: DataType.UInt16,
  lbcd: DataType.UInt32,
  date: DataType.String, // ISO 8601 string on the wire
  string: DataType.String,
};

/** Type names for addVariable — it resolves these to proper NodeIds. */
const OPCUA_DATA_TYPE_NAME: Record<TagConfig["dataType"], string> = {
  bool: "Boolean",
  int8: "SByte",
  uint8: "Byte",
  int16: "Int16",
  uint16: "UInt16",
  int32: "Int32",
  uint32: "UInt32",
  int64: "Int64",
  uint64: "UInt64",
  float32: "Float",
  float64: "Double",
  bcd: "UInt16",
  lbcd: "UInt32",
  date: "String",
  string: "String",
};

function defaultValue(dataType: DataType): TagPrimitive {
  switch (dataType) {
    case DataType.Boolean:
      return false;
    case DataType.String:
      return "";
    default:
      return 0;
  }
}

function toStatusCode(quality: Quality): StatusCode {
  switch (quality) {
    case "good":
      return StatusCodes.Good;
    case "uncertain":
      return StatusCodes.Uncertain;
    default:
      return StatusCodes.Bad;
  }
}

export async function startOpcUaServer(options: OpcUaServerOptions): Promise<OpcUaServerHandle> {
  const { engine, store, port } = options;
  const serverName = options.serverName ?? "ODIServer";
  const logger = options.logger;
  mkdirSync(options.certsDir, { recursive: true });

  const server = new OPCUAServer({
    port,
    //Bare endpoint: opc.tcp://<host>:<port>
    resourcePath: "",
    serverInfo: {
      applicationName: { text: serverName },
      applicationUri: `urn:${serverName}`,
      productUri: "ODIServer",
    },
    buildInfo: {
      productName: serverName,
      productUri: "ODIServer",
      manufacturerName: "ODIServer",
      softwareVersion: "0.1.0",
      buildNumber: "1",
      buildDate: new Date(2024, 0, 1),
    },
    allowAnonymous: true,
    // Cert/key paths derive from this manager; a self-signed certificate is
    // generated automatically on first start.
    serverCertificateManager: new OPCUACertificateManager({
      rootFolder: join(options.certsDir, "pki"),
      automaticallyAcceptUnknownCertificate: true,
    }),
  });

  await server.initialize();

  const addressSpace = server.engine.addressSpace!;
  const namespace = addressSpace.getOwnNamespace();
  const tagVariables = new Map<string, UAVariable>();
  let devicesRoot: UAObject | undefined;

  function tagDataValue(tag: TagConfig): DataValue {
    const current = engine.getValue(tag.id);
    const dataType = OPCUA_DATA_TYPE[tag.dataType];
    return new DataValue({
      value: new Variant({
        dataType,
        value: current?.value ?? defaultValue(dataType),
      }),
      statusCode: toStatusCode(current?.quality ?? "bad"),
      sourceTimestamp: new Date(current?.timestamp ?? Date.now()),
    });
  }

  function buildAddressSpace(): void {
    tagVariables.clear();
    devicesRoot = namespace.addFolder(addressSpace.rootFolder.objects, {
      browseName: "Devices",
      nodeId: "s=Devices",
    });
    const tagsByDevice = new Map<string, TagConfig[]>();
    for (const tag of store.listTags()) {
      const list = tagsByDevice.get(tag.deviceId) ?? [];
      list.push(tag);
      tagsByDevice.set(tag.deviceId, list);
    }
    for (const device of store.listDevices()) {
      const deviceNode = namespace.addObject({
        organizedBy: devicesRoot,
        browseName: device.name,
        nodeId: `s=device:${device.id}`,
      });
      for (const tag of tagsByDevice.get(device.id) ?? []) {
        const dataType = OPCUA_DATA_TYPE[tag.dataType];
        const writable = tag.access === "rw";
        const variable = namespace.addVariable({
          componentOf: deviceNode,
          browseName: tag.name,
          nodeId: `s=${tag.id}`,
          description: tag.description,
          dataType: OPCUA_DATA_TYPE_NAME[tag.dataType],
          accessLevel: writable
            ? AccessLevelFlag.CurrentRead | AccessLevelFlag.CurrentWrite
            : AccessLevelFlag.CurrentRead,
          userAccessLevel: writable
            ? AccessLevelFlag.CurrentRead | AccessLevelFlag.CurrentWrite
            : AccessLevelFlag.CurrentRead,
          minimumSamplingInterval: 250,
          value: {
            timestamped_get: () => tagDataValue(tag),
            timestamped_set: (dataValue: DataValue, callback: (err: Error | null, statusCode: StatusCode) => void) => {
              try {
                engine.write(tag.id, dataValue.value.value as TagPrimitive);
                callback(null, StatusCodes.Good);
              } catch {
                callback(null, StatusCodes.BadNotWritable);
              }
            },
          },
        });
        tagVariables.set(tag.id, variable);
        // Seed the stored value so its Variant carries the declared
        // datatype; the write-compatibility check rejects writes against
        // a Null (uninitialized) variant.
        const initial = tagDataValue(tag);
        variable.setValueFromSource(initial.value, initial.statusCode, initial.sourceTimestamp ?? undefined);
      }
    }
  }

  buildAddressSpace();

  // Push tag changes into the address space so subscriptions see them
  // immediately (reads always go through timestamped_get anyway).
  const onTagChange = (event: { tagId: string; quality: Quality; timestamp: number }) => {
    const variable = tagVariables.get(event.tagId);
    const config = engine.getConfig(event.tagId);
    if (!variable || !config) return;
    const dataType = OPCUA_DATA_TYPE[config.dataType];
    const value = engine.getValue(event.tagId)?.value ?? defaultValue(dataType);
    variable.setValueFromSource(
      new Variant({ dataType, value }),
      toStatusCode(event.quality),
      new Date(event.timestamp),
    );
  };
  engine.on("change", onTagChange);

  // Config edits: rebuild the Devices subtree (debounced; a bulk import
  // emits one change event per entity).
  let rebuildTimer: NodeJS.Timeout | undefined;
  const onConfigChange = () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      try {
        if (devicesRoot) addressSpace.deleteNode(devicesRoot);
        buildAddressSpace();
      } catch (err) {
        logger?.error({ err }, "OPC UA address space rebuild failed");
      }
    }, 250);
  };
  store.on("change", onConfigChange);

  await server.start();
  const endpointUrl = server.getEndpointUrl();
  logger?.info({ endpointUrl }, "OPC UA server listening");

  return {
    port,
    endpointUrl,
    async stop() {
      clearTimeout(rebuildTimer);
      engine.off("change", onTagChange);
      store.off("change", onConfigChange);
      await server.shutdown();
    },
  };
}
