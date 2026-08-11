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
    commandDelay: "1",
    clientTimeout: "1000",
    reconnectOnTimeout: true,
    reconnectTimeout: "2000",
    parallelUnitIdsAllowed: true,
    showErrors: false,
    showWarnings: true,
    showLogs: false,
  };
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
    if (!isModbusTcp(device, channel.driver)) continue; // modbus-rtu / opcua-client: later phases

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
    const options = blockReadOptions(device);
    for (const block of groupTagsIntoBlocks(tags, options)) {
      if (block.members.length === 1) {
        nodes.push(...modbusReadNode(block.members[0].tag, device));
      } else {
        nodes.push(...modbusBlockReadNodes(block, device));
      }
    }
  }

  return nodes;
}
