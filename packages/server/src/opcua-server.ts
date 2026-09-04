import { join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  AccessLevelFlag,
  DataType,
  DataValue,
  OPCUACertificateManager,
  OPCUAServer,
  SecurityPolicy,
  StatusCodes,
  Variant,
  type StatusCode,
  type UAObject,
  type UAVariable,
} from "node-opcua";
import type { Logger } from "pino";
import type {
  ConfigStore,
  DeviceConfig,
  Quality,
  TagConfig,
  TagEngine,
  TagPrimitive,
} from "@odiserver/core";

/**
 * Northbound OPC UA server: exposes the project's channels, devices and tags
 * as a browsable address space:
 *
 *   Objects
 *     └── <channel name>                  (object, nodeId s=<channel>)
 *           └── <device name>             (object, nodeId s=<channel>.<device>)
 *                 ├── _System             (_Enabled, _Error, _Description)
 *                 ├── _Statistics         (_SuccessfulReads, _FailedReads, ...)
 *                 └── <tag name>          (variable, nodeId s=<channel>.<device>.<tag>)
 *
 * NodeIds are dot-delimited display-name paths in the server's own namespace
 * (ns=1).
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
  /**
   * Allow anonymous OPC UA sessions. Defaults to ODISERVER_OPCUA_ALLOW_ANONYMOUS=1;
   * otherwise false (username/password required).
   */
  allowAnonymous?: boolean;
  /**
   * Permitted OPC UA users (username -> password). Defaults to
   * ODISERVER_OPCUA_USERS ("user:pass,user2:pass2") or
   * ODISERVER_OPCUA_USERNAME + ODISERVER_OPCUA_PASSWORD.
   */
  users?: Record<string, string>;
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

function usersFromEnv(): Record<string, string> {
  const users: Record<string, string> = {};
  const list = process.env.ODISERVER_OPCUA_USERS;
  if (list) {
    for (const entry of list.split(",")) {
      const sep = entry.indexOf(":");
      if (sep > 0) users[entry.slice(0, sep).trim()] = entry.slice(sep + 1);
    }
  }
  const username = process.env.ODISERVER_OPCUA_USERNAME;
  const password = process.env.ODISERVER_OPCUA_PASSWORD;
  if (username && password !== undefined) users[username] = password;
  return users;
}

export async function startOpcUaServer(options: OpcUaServerOptions): Promise<OpcUaServerHandle> {
  const { engine, store, port } = options;
  const serverName = options.serverName ?? "ODIServer";
  const logger = options.logger;
  mkdirSync(options.certsDir, { recursive: true });

  const allowAnonymous =
    options.allowAnonymous ?? process.env.ODISERVER_OPCUA_ALLOW_ANONYMOUS === "1";
  const users = options.users ?? usersFromEnv();
  if (!allowAnonymous && Object.keys(users).length === 0) {
    logger?.warn(
      "OPC UA anonymous access is disabled and no users are configured (ODISERVER_OPCUA_USERS) — all sessions will be rejected",
    );
  }
  // Cleartext SecurityPolicy None is only offered behind an explicit opt-in.
  const allowInsecure = process.env.ODISERVER_OPCUA_ALLOW_INSECURE === "1";
  const autoAcceptCerts = process.env.ODISERVER_OPCUA_AUTO_ACCEPT_CERTS === "1";

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
    allowAnonymous,
    userManager: {
      isValidUser: (username: string, password: string) =>
        users[username] !== undefined && users[username] === password,
    },
    securityPolicies: allowInsecure
      ? [SecurityPolicy.None, SecurityPolicy.Basic256Sha256, SecurityPolicy.Aes128_Sha256_RsaOaep]
      : [SecurityPolicy.Basic256Sha256, SecurityPolicy.Aes128_Sha256_RsaOaep],
    // Cert/key paths derive from this manager; a self-signed certificate is
    // generated automatically on first start. Unknown client certificates are
    // rejected until an operator moves them from rejected/ to trusted/ in the
    // PKI directory (or opts in to auto-accept for development).
    serverCertificateManager: new OPCUACertificateManager({
      rootFolder: join(options.certsDir, "pki"),
      automaticallyAcceptUnknownCertificate: autoAcceptCerts,
    }),
  });

  await server.initialize();

  const addressSpace = server.engine.addressSpace!;
  const namespace = addressSpace.getOwnNamespace();
  const tagVariables = new Map<string, UAVariable>();
  let channelRoots: UAObject[] = [];

  /** Per-device read/write counters, exposed under <device>/_Statistics. */
  interface DeviceStats {
    successfulReads: number;
    failedReads: number;
    successfulWrites: number;
    failedWrites: number;
  }
  const deviceStats = new Map<string, DeviceStats>();
  function statsFor(deviceId: string): DeviceStats {
    let s = deviceStats.get(deviceId);
    if (!s) {
      s = { successfulReads: 0, failedReads: 0, successfulWrites: 0, failedWrites: 0 };
      deviceStats.set(deviceId, s);
    }
    return s;
  }

  function tagDataValue(tag: TagConfig): DataValue {
    const current = engine.getValue(tag.id);
    const dataType = OPCUA_DATA_TYPE[tag.dataType];
    const stats = statsFor(tag.deviceId);
    if (current?.quality === "bad") stats.failedReads++;
    else stats.successfulReads++;
    return new DataValue({
      value: new Variant({
        dataType,
        value: current?.value ?? defaultValue(dataType),
      }),
      statusCode: toStatusCode(current?.quality ?? "bad"),
      sourceTimestamp: new Date(current?.timestamp ?? Date.now()),
    });
  }

  function addConstVariable(
    parent: UAObject,
    pathPrefix: string,
    name: string,
    dataTypeName: string,
    dataType: DataType,
    get: () => TagPrimitive,
  ): void {
    namespace.addVariable({
      componentOf: parent,
      browseName: name,
      nodeId: `s=${pathPrefix}.${name}`,
      dataType: dataTypeName,
      accessLevel: AccessLevelFlag.CurrentRead,
      userAccessLevel: AccessLevelFlag.CurrentRead,
      minimumSamplingInterval: 250,
      value: {
        timestamped_get: () =>
          new DataValue({
            value: new Variant({ dataType, value: get() }),
            statusCode: StatusCodes.Good,
            sourceTimestamp: new Date(),
          }),
      },
    });
  }

  /** Per-device _System object. */
  function addDeviceSystemNodes(
    deviceNode: UAObject,
    devicePath: string,
    device: DeviceConfig,
    deviceTags: TagConfig[],
  ): void {
    const systemNode = namespace.addObject({
      organizedBy: deviceNode,
      browseName: "_System",
      nodeId: `s=${devicePath}._System`,
    });
    const prefix = `${devicePath}._System`;

    const enabledVar = namespace.addVariable({
      componentOf: systemNode,
      browseName: "_Enabled",
      nodeId: `s=${prefix}._Enabled`,
      description: "Enable or disable communication with the device.",
      dataType: "Boolean",
      accessLevel: AccessLevelFlag.CurrentRead | AccessLevelFlag.CurrentWrite,
      userAccessLevel: AccessLevelFlag.CurrentRead | AccessLevelFlag.CurrentWrite,
      minimumSamplingInterval: 250,
      value: {
        timestamped_get: () =>
          new DataValue({
            value: new Variant({ dataType: DataType.Boolean, value: device.enabled }),
            statusCode: StatusCodes.Good,
            sourceTimestamp: new Date(),
          }),
        timestamped_set: (dataValue: DataValue, callback: (err: Error | null, statusCode: StatusCode) => void) => {
          try {
            store.upsertDevice({ ...device, enabled: Boolean(dataValue.value.value) });
            callback(null, StatusCodes.Good);
          } catch {
            callback(null, StatusCodes.BadNotWritable);
          }
        },
      },
    });
    enabledVar.setValueFromSource(
      new Variant({ dataType: DataType.Boolean, value: device.enabled }),
      StatusCodes.Good,
    );

    addConstVariable(systemNode, prefix, "_Error", "String", DataType.String, () => {
      const failing = deviceTags.find((t) => engine.getValue(t.id)?.error);
      return failing ? (engine.getValue(failing.id)?.error ?? "") : "";
    });
    addConstVariable(
      systemNode,
      prefix,
      "_Description",
      "String",
      DataType.String,
      () => (typeof device.settings.description === "string" ? device.settings.description : ""),
    );
  }

  /** Per-device _Statistics object. */
  function addDeviceStatisticsNodes(deviceNode: UAObject, devicePath: string, deviceId: string): void {
    const statsNode = namespace.addObject({
      organizedBy: deviceNode,
      browseName: "_Statistics",
      nodeId: `s=${devicePath}._Statistics`,
    });
    const prefix = `${devicePath}._Statistics`;
    const counters: Array<[name: string, get: (s: DeviceStats) => number]> = [
      ["_SuccessfulReads", (s) => s.successfulReads],
      ["_FailedReads", (s) => s.failedReads],
      ["_SuccessfulWrites", (s) => s.successfulWrites],
      ["_FailedWrites", (s) => s.failedWrites],
    ];
    for (const [name, get] of counters) {
      addConstVariable(statsNode, prefix, name, "UInt32", DataType.UInt32, () => get(statsFor(deviceId)));
    }
  }

  function buildAddressSpace(): void {
    tagVariables.clear();
    channelRoots = [];
    const tagsByDevice = new Map<string, TagConfig[]>();
    for (const tag of store.listTags()) {
      const list = tagsByDevice.get(tag.deviceId) ?? [];
      list.push(tag);
      tagsByDevice.set(tag.deviceId, list);
    }
    for (const channel of store.listChannels()) {
      const channelPath = channel.name;
      const channelNode = namespace.addObject({
        organizedBy: addressSpace.rootFolder.objects,
        browseName: channel.name,
        nodeId: `s=${channelPath}`,
      });
      channelRoots.push(channelNode);
      for (const device of store.listDevices(channel.id)) {
        const devicePath = `${channelPath}.${device.name}`;
        const deviceNode = namespace.addObject({
          organizedBy: channelNode,
          browseName: device.name,
          nodeId: `s=${devicePath}`,
        });
        const deviceTags = tagsByDevice.get(device.id) ?? [];
        addDeviceSystemNodes(deviceNode, devicePath, device, deviceTags);
        addDeviceStatisticsNodes(deviceNode, devicePath, device.id);
        for (const tag of deviceTags) {
          const dataType = OPCUA_DATA_TYPE[tag.dataType];
          const writable = tag.access === "rw";
          const variable = namespace.addVariable({
            componentOf: deviceNode,
            browseName: tag.name,
            nodeId: `s=${devicePath}.${tag.name}`,
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
                  statsFor(tag.deviceId).successfulWrites++;
                  callback(null, StatusCodes.Good);
                } catch {
                  statsFor(tag.deviceId).failedWrites++;
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

  // Config edits: rebuild the channel subtrees (debounced; a bulk import
  // emits one change event per entity).
  let rebuildTimer: NodeJS.Timeout | undefined;
  const onConfigChange = () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      try {
        for (const root of channelRoots) addressSpace.deleteNode(root);
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
