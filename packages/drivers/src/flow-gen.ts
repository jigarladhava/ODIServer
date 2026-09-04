import type { DeviceConfig, ProjectConfig, TagConfig } from "@odiserver/core";
import { parseModbusAddress, type ModbusTable, type ParsedModbusAddress } from "./modbus-address.js";

/** Minimal shape of a Node-RED flow object (as stored in flows.json). */
export interface NodeRedNode {
  id: string;
  type: string;
  [key: string]: unknown;
}

export const ODI_TAB_ID = "odi-tab-drivers";

function clientNodeId(deviceId: string): string {
  return `odi-client-${deviceId}`;
}
function readNodeId(tagId: string): string {
  return `odi-read-${tagId}`;
}
function blockReadNodeId(deviceId: string, table: ModbusTable, start: number): string {
  return `odi-read-block-${deviceId}-${table}-${start}`;
}
function bridgeNodeId(tagId: string): string {
  return `odi-bridge-${tagId}`;
}
function errBridgeNodeId(tagId: string): string {
  return `odi-bridge-err-${tagId}`;
}
function catchNodeId(tagId: string): string {
  return `odi-catch-${tagId}`;
}
function statusNodeId(deviceId: string): string {
  return `odi-status-${deviceId}`;
}
function deviceBridgeNodeId(deviceId: string): string {
  return `odi-bridge-dev-${deviceId}`;
}

function isModbusTcp(device: DeviceConfig, channelDriver: string): boolean {
  return channelDriver === "modbus-tcp";
}

function deviceHost(device: DeviceConfig): { host: string; port: number; unitId: number } {
  const s = device.settings as { host?: string; port?: number; unitId?: number };
  return {
    host: s.host ?? "127.0.0.1",
    port: s.port ?? 502,
    unitId: s.unitId ?? 1,
  };
}

/**
 * Per-device communication tuning
 * Only what node-red-contrib-modbus actually supports is wired into the
 * client node: requestTimeoutMs -> clientTimeout, interRequestDelayMs ->
 * commandDelay. connectTimeoutSec / retryAttempts are stored in settings
 * for config parity (the modbus stack has no knobs for them).
 */
function deviceComm(device: DeviceConfig): { requestTimeoutMs: number; interRequestDelayMs: number } {
  const s = device.settings as { requestTimeoutMs?: number; interRequestDelayMs?: number };
  return {
    requestTimeoutMs:
      typeof s.requestTimeoutMs === "number" && s.requestTimeoutMs > 0 ? s.requestTimeoutMs : 1000,
    interRequestDelayMs:
      typeof s.interRequestDelayMs === "number" && s.interRequestDelayMs >= 0
        ? s.interRequestDelayMs
        : 1,
  };
}

/**
 * Effective poll rate for a tag. 
 * "respect-tag" (default, per-tag scanRateMs) or
 * "respect-device" (all tags polled at settings.scanModeRateMs).
 */
export function effectiveScanRateMs(tag: TagConfig, device: DeviceConfig): number {
  const s = device.settings as { scanMode?: string; scanModeRateMs?: number };
  if (s.scanMode === "respect-device") {
    const rate = typeof s.scanModeRateMs === "number" && s.scanModeRateMs >= 50 ? s.scanModeRateMs : 1000;
    return rate;
  }
  return tag.scanRateMs;
}

function modbusReadNode(tag: TagConfig, device: DeviceConfig): NodeRedNode[] {
  const parsed = parseModbusAddress(tag.address, tag.dataType);
  const { unitId } = deviceHost(device);
  const readId = readNodeId(tag.id);

  const readNode: NodeRedNode = {
    id: readId,
    type: "modbus-read",
    z: ODI_TAB_ID,
    name: tag.name,
    topic: tag.id,
    unitid: String(unitId),
    dataType: parsed.readDataType,
    adr: String(parsed.offset),
    quantity: String(parsed.registerCount),
    rate: String(tag.scanRateMs),
    rateUnit: "ms",
    server: clientNodeId(device.id),
    delayOnStart: false,
    startDelayTime: "1",
    showStatusActivities: false,
    showErrors: false,
    showWarnings: true,
    // Forward read failures (modbus exceptions) to the bridge as msg.error
    emptyMsgOnFail: true,
    useIOFile: false,
    useIOForPayload: false,
    wires: [[bridgeNodeId(tag.id)], []],
  };

  const bridgeNode: NodeRedNode = {
    id: bridgeNodeId(tag.id),
    type: "odi-tag-in",
    z: ODI_TAB_ID,
    name: `tag:${tag.name}`,
    tagId: tag.id,
    mode: "value",
    quality: "good",
    wires: [],
  };

  // On read failure, mark the tag bad via a catch node scoped to this read node.
  const catchNode: NodeRedNode = {
    id: catchNodeId(tag.id),
    type: "catch",
    z: ODI_TAB_ID,
    name: `err:${tag.name}`,
    scope: [readId],
    uncaught: false,
    wires: [[errBridgeNodeId(tag.id)]],
  };

  const errBridgeNode: NodeRedNode = {
    id: errBridgeNodeId(tag.id),
    type: "odi-tag-in",
    z: ODI_TAB_ID,
    name: `tag-err:${tag.name}`,
    tagId: tag.id,
    mode: "quality",
    quality: "bad",
    wires: [],
  };

  return [readNode, bridgeNode, catchNode, errBridgeNode];
}

/* ------------------------------------------------------------------ *
 * Block reads (automatic request coalescing)
 *
 * Tags on the same device, table and scan rate are merged into a
 * single multi-register read whenever they fit within the limits:
 *   - maxBlockSize: max registers/coils per request (default 120,
 *     clamped to the protocol ceiling per table). Multi-register
 *     values are never split across requests, so the classic
 *     "Bad address in block" error cannot occur.
 *   - maxGap: largest hole of unmapped addresses a block may span
 *     (default 8). Bigger holes start a new block, so devices with
 *     non-contiguous memory don't get requests rejected.
 * Disable per device with settings.blockReads = false for slaves that
 * reject multi-register reads.
 * ------------------------------------------------------------------ */

/** Protocol ceiling for one request, per table (bits for coils, words for registers). */
const PROTOCOL_MAX_QUANTITY: Record<ModbusTable, number> = {
  coil: 2000,
  discrete: 2000,
  input: 125,
  holding: 125,
};

export interface BlockReadOptions {
  enabled: boolean;
  maxBlockSize: number;
  maxGap: number;
}

export const DEFAULT_BLOCK_READ_OPTIONS: BlockReadOptions = {
  enabled: true,
  maxBlockSize: 120,
  maxGap: 8,
};

export function blockReadOptions(device: DeviceConfig): BlockReadOptions {
  const s = device.settings as { blockReads?: boolean; maxBlockSize?: number; maxGap?: number };
  const num = (v: number | undefined, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  return {
    enabled: s.blockReads ?? DEFAULT_BLOCK_READ_OPTIONS.enabled,
    maxBlockSize: Math.max(1, num(s.maxBlockSize, DEFAULT_BLOCK_READ_OPTIONS.maxBlockSize)),
    maxGap: Math.max(0, num(s.maxGap, DEFAULT_BLOCK_READ_OPTIONS.maxGap)),
  };
}

export interface BlockMember {
  tag: TagConfig;
  parsed: ParsedModbusAddress;
}

export interface ReadBlock {
  table: ModbusTable;
  scanRateMs: number;
  /** Offset of the first register/coil in the block. */
  start: number;
  /** Exclusive end offset (start + quantity). */
  end: number;
  members: BlockMember[];
}

/**
 * Group tags into coalesced read blocks. Tags are only merged within the
 * same table and scan rate (never mix slow and fast tags in one request).
 * Tags must already have valid Modbus addresses.
 */
export function groupTagsIntoBlocks(tags: TagConfig[], options: BlockReadOptions): ReadBlock[] {
  const byGroup = new Map<string, BlockMember[]>();
  for (const tag of tags) {
    const parsed = parseModbusAddress(tag.address, tag.dataType);
    const key = `${parsed.table}:${tag.scanRateMs}`;
    const group = byGroup.get(key);
    if (group) group.push({ tag, parsed });
    else byGroup.set(key, [{ tag, parsed }]);
  }

  const blocks: ReadBlock[] = [];
  for (const members of byGroup.values()) {
    members.sort((a, b) => a.parsed.offset - b.parsed.offset);
    let current: ReadBlock | null = null;
    for (const member of members) {
      const mStart = member.parsed.offset;
      const mEnd = mStart + member.parsed.registerCount;
      if (!current) {
        current = { table: member.parsed.table, scanRateMs: member.tag.scanRateMs, start: mStart, end: mEnd, members: [member] };
        continue;
      }
      const hole = Math.max(0, mStart - current.end);
      const newEnd = Math.max(current.end, mEnd);
      const span = newEnd - current.start;
      const limit = Math.min(options.maxBlockSize, PROTOCOL_MAX_QUANTITY[current.table]);
      if (options.enabled && hole <= options.maxGap && span <= limit) {
        current.end = newEnd;
        current.members.push(member);
      } else {
        blocks.push(current);
        current = { table: current.table, scanRateMs: current.scanRateMs, start: mStart, end: mEnd, members: [member] };
      }
    }
    if (current) blocks.push(current);
  }
  return blocks;
}

const TABLE_ADDRESS_BASE: Record<ModbusTable, number> = {
  coil: 1,
  discrete: 10001,
  input: 30001,
  holding: 40001,
};

function blockName(block: ReadBlock): string {
  const base = TABLE_ADDRESS_BASE[block.table];
  return `block:${base + block.start}-${base + block.end - 1} (${block.members.length} tags)`;
}

/**
 * Nodes for a multi-tag block: one modbus-read for the whole span, wired
 * to every member tag's bridge. Each bridge slices its own registers out
 * of the block payload (see blockOffset/blockCount in odi-tag-in). A single
 * catch node marks all member tags bad when the block read fails.
 */
function modbusBlockReadNodes(block: ReadBlock, device: DeviceConfig): NodeRedNode[] {
  const { unitId } = deviceHost(device);
  const readId = blockReadNodeId(device.id, block.table, block.start);

  const readNode: NodeRedNode = {
    id: readId,
    type: "modbus-read",
    z: ODI_TAB_ID,
    name: blockName(block),
    // Must not equal any node id: generated nodes carry no x/y, so Node-RED
    // treats them as config nodes and flags a self-referencing property as a
    // circular config dependency. The bridge ignores msg.topic anyway.
    topic: blockName(block),
    unitid: String(unitId),
    dataType: block.members[0].parsed.readDataType,
    adr: String(block.start),
    quantity: String(block.end - block.start),
    rate: String(block.scanRateMs),
    rateUnit: "ms",
    server: clientNodeId(device.id),
    delayOnStart: false,
    startDelayTime: "1",
    showStatusActivities: false,
    showErrors: false,
    showWarnings: true,
    emptyMsgOnFail: true,
    useIOFile: false,
    useIOForPayload: false,
    wires: [block.members.map((m) => bridgeNodeId(m.tag.id)), []],
  };

  const nodes: NodeRedNode[] = [readNode];
  for (const member of block.members) {
    nodes.push({
      id: bridgeNodeId(member.tag.id),
      type: "odi-tag-in",
      z: ODI_TAB_ID,
      name: `tag:${member.tag.name}`,
      tagId: member.tag.id,
      mode: "value",
      quality: "good",
      blockOffset: member.parsed.offset - block.start,
      blockCount: member.parsed.registerCount,
      wires: [],
    });
  }

  nodes.push({
    id: catchNodeId(readId),
    type: "catch",
    z: ODI_TAB_ID,
    name: `err:${blockName(block)}`,
    scope: [readId],
    uncaught: false,
    wires: [block.members.map((m) => errBridgeNodeId(m.tag.id))],
  });

  for (const member of block.members) {
    nodes.push({
      id: errBridgeNodeId(member.tag.id),
      type: "odi-tag-in",
      z: ODI_TAB_ID,
      name: `tag-err:${member.tag.name}`,
      tagId: member.tag.id,
      mode: "quality",
      quality: "bad",
      wires: [],
    });
  }

  return nodes;
}

function modbusClientNode(device: DeviceConfig): NodeRedNode {
  const { host, port, unitId } = deviceHost(device);
  const comm = deviceComm(device);
  return {
    id: clientNodeId(device.id),
    type: "modbus-client",
    z: ODI_TAB_ID,
    name: device.name,
    clienttype: "tcp",
    bufferCommands: true,
    stateLogEnabled: false,
    queueLogEnabled: false,
    failureLogEnabled: false,
    tcpHost: host,
    tcpPort: String(port),
    tcpType: "DEFAULT",
    unit_id: String(unitId),
    commandDelay: String(comm.interRequestDelayMs),
    clientTimeout: String(comm.requestTimeoutMs),
    reconnectOnTimeout: true,
    reconnectTimeout: "2000",
    parallelUnitIdsAllowed: true,
    showErrors: false,
    showWarnings: true,
    showLogs: false,
  };
}

/* ------------------------------------------------------------------ *
 * Writes
 *
 * Writable tags (access "rw" on the coil/holding tables) get a pair of
 * nodes: an odi-tag-out bridge that turns engine "write" events into
 * wire-format register values, feeding a modbus-write node.
 *
 * Limitations of the underlying modbus stack (settings are stored in
 * device/channel settings for parity but cannot be applied):
 *   - FC05/06 vs FC15/16 selection (settings.useFc05Fc06): modbus-write
 *     picks the function code itself from the data type and quantity.
 *   - FC22 masked writes (settings.bitMaskWrites): not supported.
 *   - Channel write optimization (writeOptimizationMethod/dutyCycle):
 *     writes are forwarded immediately ("write all values" behavior).
 * ------------------------------------------------------------------ */

function modbusWriteNodes(tag: TagConfig, device: DeviceConfig, parsed: ParsedModbusAddress): NodeRedNode[] {
  const { unitId } = deviceHost(device);
  const writeId = `odi-write-${tag.id}`;
  const outId = `odi-out-${tag.id}`;
  return [
    {
      id: outId,
      type: "odi-tag-out",
      z: ODI_TAB_ID,
      name: `out:${tag.name}`,
      tagId: tag.id,
      wires: [[writeId]],
    },
    {
      id: writeId,
      type: "modbus-write",
      z: ODI_TAB_ID,
      name: `write:${tag.name}`,
      unitid: String(unitId),
      dataType: parsed.table === "coil" ? "Coil" : "HoldingRegister",
      adr: String(parsed.offset),
      quantity: String(parsed.registerCount),
      server: clientNodeId(device.id),
      emptyMsgOnFail: false,
      keepMsgProperties: true,
      showStatusActivities: false,
      showErrors: true,
      showWarnings: true,
      delayOnStart: false,
      startDelayTime: "1",
      wires: [[], []],
    },
  ];
}

/**
 * Watch the device's client node status so connection loss marks all of the
 * device's tags bad (per-tag reads simply stop when the link is down).
 */
function deviceStatusNodes(device: DeviceConfig): NodeRedNode[] {
  return [
    {
      id: statusNodeId(device.id),
      type: "status",
      z: ODI_TAB_ID,
      name: `link:${device.name}`,
      scope: [clientNodeId(device.id)],
      wires: [[deviceBridgeNodeId(device.id)]],
    },
    {
      id: deviceBridgeNodeId(device.id),
      type: "odi-tag-in",
      z: ODI_TAB_ID,
      name: `link-err:${device.name}`,
      deviceId: device.id,
      mode: "device-quality",
      quality: "bad",
      wires: [],
    },
  ];
}

/* ------------------------------------------------------------------ *
 * OPC UA client driver (node-red-contrib-opcua)
 *
 * Per connection group (channels sharing endpoint + security + auth):
 *   odi-opcua-sub (per channel) ──> OpcUa-Client ──(values)──> odi-opcua-in (one per group)
 *   odi-opcua-out (per channel) ──>      │       ──(errors)──>      │
 *                             status(client) ────────────>     │
 *
 * odi-opcua-sub drives tag reads in one of two update modes:
 *   subscribe (default) — one subscribe msg per tag ({ topic: nodeId,
 *     interval: scanRateMs }); the client node queues them while
 *     connecting and auto-resubscribes after reconnects.
 *   poll — registers the channel's tags as a batched read list on the
 *     client, then triggers a readmultiple at the channel's fastest
 *     effective scan rate.
 * The client broadcasts inbound msgs to every in-bridge of the group;
 * each routes to its channel's tag engine by nodeId. odi-opcua-out
 * forwards engine writes as typed write msgs
 * ({ topic: "<nodeId>;datatype=<T>", action:"write" }).
 *
 * Channel settings:
 *   endpointUrl     opc.tcp://host:port (default opc.tcp://127.0.0.1:49320)
 *   securityPolicy  None | Basic128Rsa15 | Basic256 | Basic256Sha256 |
 *                   Aes128_Sha256_RsaOaep | Aes256_Sha256_RsaPss (default None)
 *   securityMode    None | Sign | SignAndEncrypt (default None)
 *   authType        anonymous (default) | username | certificate
 *   username        authType=username: user name (stored as a Node-RED
 *   password        credential on the endpoint node, encrypted at rest)
 *   userCertificateFile   authType=certificate: user cert file path
 *   userPrivateKeyFile    authType=certificate: private key file path
 *   clientCertificateFile transport cert for Sign/SignAndEncrypt (default:
 *   clientPrivateKeyFile  the client's auto-generated self-signed cert)
 *   updateMode      subscribe (default) | poll
 *   keepSessionAlive  re-establish dropped sessions (default true)
 *   applicationName client application name presented to the server
 *   publishIntervalMs  subscription publishing interval (default 500)
 * ------------------------------------------------------------------ */

function opcuaEndpointNodeId(groupId: string): string {
  return `odi-opcua-ep-${groupId}`;
}
function opcuaClientNodeId(groupId: string): string {
  return `odi-opcua-client-${groupId}`;
}
function opcuaSubNodeId(channelId: string): string {
  return `odi-opcua-sub-${channelId}`;
}
function opcuaInNodeId(groupId: string): string {
  return `odi-opcua-in-${groupId}`;
}
function opcuaOutNodeId(channelId: string): string {
  return `odi-opcua-out-${channelId}`;
}
function opcuaStatusNodeId(groupId: string): string {
  return `odi-opcua-status-${groupId}`;
}

function isOpcUaAddress(address: string): boolean {
  return /^ns=\d+;[isgb]=/i.test(address.trim());
}

interface OpcUaChannelSettings {
  endpointUrl?: string;
  securityPolicy?: string;
  securityMode?: string;
  authType?: string;
  username?: string;
  password?: string;
  userCertificateFile?: string;
  userPrivateKeyFile?: string;
  clientCertificateFile?: string;
  clientPrivateKeyFile?: string;
  updateMode?: string;
  keepSessionAlive?: boolean;
  applicationName?: string;
  publishIntervalMs?: number;
}

function opcuaAuthType(s: OpcUaChannelSettings): "anonymous" | "username" | "certificate" {
  // "username" is implied when a username is set even if authType was left
  // unset (e.g. hand-edited configs).
  if (s.authType === "username" || s.authType === "certificate") return s.authType;
  return s.username ? "username" : "anonymous";
}

/**
 * Everything that defines a distinct server connection. Channels with the
 * same key share one endpoint config node and one client session — a
 * converted project can have 100+ channels all pointing at the same
 * server, and one session per channel blows past server session limits
 * (the server starts dropping connections: BadConnectionClosed).
 */
function opcuaConnectionKey(s: OpcUaChannelSettings): string {
  return [
    s.endpointUrl ?? "opc.tcp://127.0.0.1:49320",
    s.securityPolicy ?? "None",
    s.securityMode ?? "None",
    opcuaAuthType(s),
    s.username ?? "",
    s.password ?? "",
    s.userCertificateFile ?? "",
    s.userPrivateKeyFile ?? "",
    s.clientCertificateFile ?? "",
    s.clientPrivateKeyFile ?? "",
    s.applicationName ?? "",
    String(s.keepSessionAlive ?? true),
  ].join("|");
}

/** Stable short id for a connection group (djb2, base36). */
function opcuaGroupId(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function opcuaPublishInterval(channels: OpcUaChannelSettings[]): number {
  let min = Infinity;
  for (const s of channels) {
    if (typeof s.publishIntervalMs === "number" && s.publishIntervalMs >= 100 && s.publishIntervalMs < min) {
      min = s.publishIntervalMs;
    }
  }
  return min === Infinity ? 500 : min;
}

/**
 * Nodes for one connection group: a shared endpoint + client session, one
 * in-bridge routing values across the whole group (tag addresses embed the
 * channel name, so a single router is unambiguous — and avoids broadcasting
 * every value msg to dozens of per-channel nodes), then per channel a sub
 * bridge (drives reads) and an out bridge (writes). One status watcher
 * marks every channel of the group bad on connection loss.
 */
function opcuaGroupNodes(
  channels: { channel: ProjectConfig["channels"][number]; hasWritableTags: boolean }[],
): NodeRedNode[] {
  const settings = channels.map((c) => c.channel.settings as OpcUaChannelSettings);
  const s = settings[0];
  const groupId = opcuaGroupId(opcuaConnectionKey(s));
  const endpointId = opcuaEndpointNodeId(groupId);
  const clientId = opcuaClientNodeId(groupId);
  const inId = opcuaInNodeId(groupId);
  const channelIds = channels.map((c) => c.channel.id);
  const authType = opcuaAuthType(s);
  const publish = opcuaPublishInterval(settings);
  const label = s.endpointUrl ?? "opc.tcp://127.0.0.1:49320";

  const nodes: NodeRedNode[] = [
    {
      id: endpointId,
      type: "OpcUa-Endpoint",
      z: ODI_TAB_ID,
      name: `${label} endpoint`,
      endpoint: label,
      secpol: s.securityPolicy ?? "None",
      secmode: s.securityMode ?? "None",
      login: authType === "username",
      none: authType === "anonymous",
      usercert: authType === "certificate",
      usercertificate: authType === "certificate" ? (s.userCertificateFile ?? "") : "",
      userprivatekey: authType === "certificate" ? (s.userPrivateKeyFile ?? "") : "",
      // Node-RED extracts inline credentials during setFlows and stores them
      // encrypted (flows_cred.json), never in the flow file itself.
      ...(authType === "username"
        ? { credentials: { user: s.username ?? "", password: s.password ?? "" } }
        : {}),
    },
    {
      id: clientId,
      type: "OpcUa-Client",
      z: ODI_TAB_ID,
      name: label,
      endpoint: endpointId,
      action: "subscribe",
      time: String(publish),
      timeUnit: "ms",
      // "l" = local certificate file (transport cert for Sign/SignAndEncrypt);
      // "n" = let the client use its auto-generated self-signed certificate.
      certificate: s.clientCertificateFile ? "l" : "n",
      localfile: s.clientCertificateFile ?? "",
      localkeyfile: s.clientPrivateKeyFile ?? "",
      useTransport: false,
      keepsessionalive: s.keepSessionAlive ?? true,
      applicationName: s.applicationName ?? "",
      wires: [[inId], [inId], []],
    },
    {
      id: opcuaStatusNodeId(groupId),
      type: "status",
      z: ODI_TAB_ID,
      name: `link:${label}`,
      scope: [clientId],
      wires: [[inId]],
    },
    {
      id: inId,
      type: "odi-opcua-in",
      z: ODI_TAB_ID,
      name: `in:${label}`,
      channelIds,
      wires: [],
    },
  ];

  for (const { channel, hasWritableTags } of channels) {
    const cs = channel.settings as OpcUaChannelSettings;
    nodes.push({
      id: opcuaSubNodeId(channel.id),
      type: "odi-opcua-sub",
      z: ODI_TAB_ID,
      name: `sub:${channel.name}`,
      channelId: channel.id,
      updateMode: cs.updateMode === "poll" ? "poll" : "subscribe",
      wires: [[clientId]],
    });
    if (hasWritableTags) {
      nodes.push({
        id: opcuaOutNodeId(channel.id),
        type: "odi-opcua-out",
        z: ODI_TAB_ID,
        name: `out:${channel.name}`,
        channelId: channel.id,
        wires: [[clientId]],
      });
    }
  }
  return nodes;
}


/**
 * Generate the full Node-RED flow set for the current project config.
 * Only enabled channels/devices/tags produce nodes. Unknown or invalid
 * tag addresses are skipped (the tag stays bad quality).
 */
export function generateFlows(project: ProjectConfig): NodeRedNode[] {
  const tab: NodeRedNode = { id: ODI_TAB_ID, type: "tab", label: "ODIServer Drivers", disabled: false, info: "" };
  const nodes: NodeRedNode[] = [tab];

  const channelById = new Map(project.channels.map((c) => [c.id, c]));
  const tagsByDevice = new Map<string, TagConfig[]>();
  for (const tag of project.tags) {
    if (!tagsByDevice.has(tag.deviceId)) tagsByDevice.set(tag.deviceId, []);
    tagsByDevice.get(tag.deviceId)!.push(tag);
  }

  for (const device of project.devices) {
    if (!device.enabled) continue;
    const channel = channelById.get(device.channelId);
    if (!channel || !channel.enabled) continue;
    if (!isModbusTcp(device, channel.driver)) continue; // modbus-rtu: later phase; opcua-client handled below

    const tags = (tagsByDevice.get(device.id) ?? []).filter((t) => {
      try {
        parseModbusAddress(t.address, t.dataType);
        return true;
      } catch {
        return false;
      }
    });
    if (tags.length === 0) continue;

    nodes.push(modbusClientNode(device));
    nodes.push(...deviceStatusNodes(device));

    // Writes: rw tags on the coil/holding tables get bridge + write nodes.
    for (const tag of tags) {
      if (tag.access !== "rw") continue;
      const parsed = parseModbusAddress(tag.address, tag.dataType);
      if (parsed.table !== "coil" && parsed.table !== "holding") continue;
      nodes.push(...modbusWriteNodes(tag, device, parsed));
    }

    // Reads: honor the device scan mode by folding it into the tag rate.
    const effectiveTags = tags.map((t) => ({ ...t, scanRateMs: effectiveScanRateMs(t, device) }));
    const options = blockReadOptions(device);
    for (const block of groupTagsIntoBlocks(effectiveTags, options)) {
      if (block.members.length === 1) {
        nodes.push(...modbusReadNode(block.members[0].tag, device));
      } else {
        nodes.push(...modbusBlockReadNodes(block, device));
      }
    }
  }

  // OPC UA client channels: one shared endpoint + client session per unique
  // connection (endpointUrl + security + auth + certs); the odi-opcua-*
  // bridge nodes stay per channel.
  const opcuaGroups = new Map<string, { channel: ProjectConfig["channels"][number]; hasWritableTags: boolean }[]>();
  for (const channel of project.channels) {
    if (!channel.enabled || channel.driver !== "opcua-client") continue;
    const devices = project.devices.filter((d) => d.channelId === channel.id && d.enabled);
    const tags = devices.flatMap((d) => tagsByDevice.get(d.id) ?? []);
    const valid = tags.filter((t) => isOpcUaAddress(t.address));
    if (valid.length === 0) continue;
    const key = opcuaConnectionKey(channel.settings as OpcUaChannelSettings);
    if (!opcuaGroups.has(key)) opcuaGroups.set(key, []);
    opcuaGroups.get(key)!.push({ channel, hasWritableTags: valid.some((t) => t.access === "rw") });
  }
  for (const group of opcuaGroups.values()) {
    nodes.push(...opcuaGroupNodes(group));
  }

  return nodes;
}
