import { EventEmitter } from "node:events";
import Database from "better-sqlite3";
import {
  ChannelSchema,
  DeviceSchema,
  MqttAgentSchema,
  ProjectSchema,
  TagSchema,
  type ChannelConfig,
  type DeviceConfig,
  type MqttAgentConfig,
  type ProjectConfig,
  type TagConfig,
} from "./config.js";

export type EntityKind = "channel" | "device" | "tag" | "mqttAgent";

export interface ConfigChangeEvent {
  kind: EntityKind;
  action: "upsert" | "remove";
  id: string;
}

export declare interface ConfigStore {
  on(event: "change", listener: (e: ConfigChangeEvent) => void): this;
}

/**
 * SQLite-backed persistence for the channel/device/tag configuration.
 * Pass ":memory:" for tests. Emits `change` on every mutation so the
 * server can regenerate driver flows and reload the tag engine.
 */
export class ConfigStore extends EventEmitter {
  private db: Database.Database;

  constructor(dbPath: string) {
    super();
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mqtt_agents (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_devices_channel ON devices(channel_id);
      CREATE INDEX IF NOT EXISTS idx_tags_device ON tags(device_id);
    `);
  }

  close(): void {
    this.db.close();
  }

  // ---- channels ----

  listChannels(): ChannelConfig[] {
    const rows = this.db.prepare("SELECT data FROM channels").all() as { data: string }[];
    return rows.map((r) => ChannelSchema.parse(JSON.parse(r.data)));
  }

  getChannel(id: string): ChannelConfig | undefined {
    const row = this.db.prepare("SELECT data FROM channels WHERE id = ?").get(id) as
      | { data: string }
      | undefined;
    return row ? ChannelSchema.parse(JSON.parse(row.data)) : undefined;
  }

  upsertChannel(config: ChannelConfig): ChannelConfig {
    const parsed = ChannelSchema.parse(config);
    this.db
      .prepare("INSERT INTO channels (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(parsed.id, JSON.stringify(parsed));
    this.emit("change", { kind: "channel", action: "upsert", id: parsed.id });
    return parsed;
  }

  removeChannel(id: string): boolean {
    // Cascade: remove child devices and their tags
    const deviceIds = this.listDevices(id).map((d) => d.id);
    for (const deviceId of deviceIds) this.removeDevice(deviceId);
    const result = this.db.prepare("DELETE FROM channels WHERE id = ?").run(id);
    if (result.changes > 0) {
      this.emit("change", { kind: "channel", action: "remove", id });
      return true;
    }
    return false;
  }

  // ---- devices ----

  listDevices(channelId?: string): DeviceConfig[] {
    const rows = (
      channelId
        ? this.db.prepare("SELECT data FROM devices WHERE channel_id = ?").all(channelId)
        : this.db.prepare("SELECT data FROM devices").all()
    ) as { data: string }[];
    return rows.map((r) => DeviceSchema.parse(JSON.parse(r.data)));
  }

  getDevice(id: string): DeviceConfig | undefined {
    const row = this.db.prepare("SELECT data FROM devices WHERE id = ?").get(id) as
      | { data: string }
      | undefined;
    return row ? DeviceSchema.parse(JSON.parse(row.data)) : undefined;
  }

  upsertDevice(config: DeviceConfig): DeviceConfig {
    const parsed = DeviceSchema.parse(config);
    if (!this.getChannel(parsed.channelId)) {
      throw new Error(`Unknown channel: ${parsed.channelId}`);
    }
    this.db
      .prepare(
        "INSERT INTO devices (id, channel_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, data = excluded.data",
      )
      .run(parsed.id, parsed.channelId, JSON.stringify(parsed));
    this.emit("change", { kind: "device", action: "upsert", id: parsed.id });
    return parsed;
  }

  removeDevice(id: string): boolean {
    for (const tag of this.listTags(id)) this.removeTag(tag.id);
    const result = this.db.prepare("DELETE FROM devices WHERE id = ?").run(id);
    if (result.changes > 0) {
      this.emit("change", { kind: "device", action: "remove", id });
      return true;
    }
    return false;
  }

  // ---- tags ----

  listTags(deviceId?: string): TagConfig[] {
    const rows = (
      deviceId
        ? this.db.prepare("SELECT data FROM tags WHERE device_id = ?").all(deviceId)
        : this.db.prepare("SELECT data FROM tags").all()
    ) as { data: string }[];
    return rows.map((r) => TagSchema.parse(JSON.parse(r.data)));
  }

  getTag(id: string): TagConfig | undefined {
    const row = this.db.prepare("SELECT data FROM tags WHERE id = ?").get(id) as
      | { data: string }
      | undefined;
    return row ? TagSchema.parse(JSON.parse(row.data)) : undefined;
  }

  upsertTag(config: TagConfig): TagConfig {
    const parsed = TagSchema.parse(config);
    if (!this.getDevice(parsed.deviceId)) {
      throw new Error(`Unknown device: ${parsed.deviceId}`);
    }
    this.db
      .prepare(
        "INSERT INTO tags (id, device_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET device_id = excluded.device_id, data = excluded.data",
      )
      .run(parsed.id, parsed.deviceId, JSON.stringify(parsed));
    this.emit("change", { kind: "tag", action: "upsert", id: parsed.id });
    return parsed;
  }

  removeTag(id: string): boolean {
    const result = this.db.prepare("DELETE FROM tags WHERE id = ?").run(id);
    if (result.changes > 0) {
      this.emit("change", { kind: "tag", action: "remove", id });
      return true;
    }
    return false;
  }

  // ---- mqtt agents ----

  listMqttAgents(): MqttAgentConfig[] {
    const rows = this.db.prepare("SELECT data FROM mqtt_agents").all() as { data: string }[];
    return rows.map((r) => MqttAgentSchema.parse(JSON.parse(r.data)));
  }

  getMqttAgent(id: string): MqttAgentConfig | undefined {
    const row = this.db.prepare("SELECT data FROM mqtt_agents WHERE id = ?").get(id) as
      | { data: string }
      | undefined;
    return row ? MqttAgentSchema.parse(JSON.parse(row.data)) : undefined;
  }

  upsertMqttAgent(config: MqttAgentConfig): MqttAgentConfig {
    const parsed = MqttAgentSchema.parse(config);
    this.db
      .prepare(
        "INSERT INTO mqtt_agents (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
      )
      .run(parsed.id, JSON.stringify(parsed));
    this.emit("change", { kind: "mqttAgent", action: "upsert", id: parsed.id });
    return parsed;
  }

  removeMqttAgent(id: string): boolean {
    const result = this.db.prepare("DELETE FROM mqtt_agents WHERE id = ?").run(id);
    if (result.changes > 0) {
      this.emit("change", { kind: "mqttAgent", action: "remove", id });
      return true;
    }
    return false;
  }

  // ---- whole project ----

  getProject(): ProjectConfig {
    return {
      channels: this.listChannels(),
      devices: this.listDevices(),
      tags: this.listTags(),
      mqttAgents: this.listMqttAgents(),
    };
  }

  /**
   * Replace the entire configuration with the given project, atomically.
   * Emits one `change` event per removed/added entity so listeners
   * (tag engine reload, flow redeploy) reconcile once per entity.
   */
  replaceProject(project: ProjectConfig): void {
    const parsed = ProjectSchema.parse(project);
    const run = this.db.transaction(() => {
      this.db.exec("DELETE FROM tags; DELETE FROM devices; DELETE FROM channels; DELETE FROM mqtt_agents;");
      const insChannel = this.db.prepare("INSERT INTO channels (id, data) VALUES (?, ?)");
      const insDevice = this.db.prepare("INSERT INTO devices (id, channel_id, data) VALUES (?, ?, ?)");
      const insTag = this.db.prepare("INSERT INTO tags (id, device_id, data) VALUES (?, ?, ?)");
      const insAgent = this.db.prepare("INSERT INTO mqtt_agents (id, data) VALUES (?, ?)");
      for (const c of parsed.channels) insChannel.run(c.id, JSON.stringify(c));
      for (const d of parsed.devices) insDevice.run(d.id, d.channelId, JSON.stringify(d));
      for (const t of parsed.tags) insTag.run(t.id, t.deviceId, JSON.stringify(t));
      for (const a of parsed.mqttAgents) insAgent.run(a.id, JSON.stringify(a));
    });
    run();
    this.emit("change", { kind: "channel", action: "upsert", id: "*" });
  }

  /**
   * Merge a project into the current configuration (upsert semantics).
   * Referential integrity is checked per entity by the upsert methods.
   */
  mergeProject(project: ProjectConfig): void {
    const parsed = ProjectSchema.parse(project);
    const run = this.db.transaction(() => {
      for (const c of parsed.channels) {
        this.db
          .prepare("INSERT INTO channels (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
          .run(c.id, JSON.stringify(c));
      }
      for (const d of parsed.devices) {
        if (!this.getChannel(d.channelId)) throw new Error(`Unknown channel: ${d.channelId} (device ${d.id})`);
        this.db
          .prepare(
            "INSERT INTO devices (id, channel_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, data = excluded.data",
          )
          .run(d.id, d.channelId, JSON.stringify(d));
      }
      for (const t of parsed.tags) {
        if (!this.getDevice(t.deviceId)) throw new Error(`Unknown device: ${t.deviceId} (tag ${t.id})`);
        this.db
          .prepare(
            "INSERT INTO tags (id, device_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET device_id = excluded.device_id, data = excluded.data",
          )
          .run(t.id, t.deviceId, JSON.stringify(t));
      }
      for (const a of parsed.mqttAgents) {
        this.db
          .prepare(
            "INSERT INTO mqtt_agents (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
          )
          .run(a.id, JSON.stringify(a));
      }
    });
    run();
    this.emit("change", { kind: "channel", action: "upsert", id: "*" });
  }
}
