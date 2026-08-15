import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import type { Logger } from "pino";
import type {
  ConfigStore,
  MqttAgentConfig,
  Quality,
  TagConfig,
  TagEngine,
  TagPrimitive,
  TagValue,
} from "@odiserver/core";
import {
  exceedsDeadband,
  renderPayload,
  renderTopic,
  resolvePublishConfig,
  type PublishContext,
} from "./render.js";

/**
 * One running MQTT agent: owns the broker connection, subscribes to tag
 * engine change events, runs interval timers, and applies the effective
 * per-tag publish configuration (agent defaults + per-tag overrides).
 *
 * The broker connection is created through an injectable connect function
 * so tests can substitute a fake client.
 */

export interface MqttClientLike {
  readonly connected: boolean;
  publish(
    topic: string,
    payload: string,
    opts: { qos: 0 | 1 | 2; retain: boolean },
  ): void;
  on(event: string, listener: (...args: never[]) => void): void;
  end(force?: boolean): void;
}

export type MqttConnectFn = (url: string, options: IClientOptions) => MqttClientLike;

export interface MqttAgentRuntimeOptions {
  agent: MqttAgentConfig;
  engine: TagEngine;
  store: ConfigStore;
  logger?: Logger;
  connectFn?: MqttConnectFn;
  /** Base directory for resolving relative TLS certificate paths. */
  dataDir?: string;
}

export interface MqttAgentStatus {
  state: "disabled" | "connecting" | "connected" | "error";
  lastError?: string;
  publishedCount: number;
  lastPublishAt?: number;
}

const defaultConnect: MqttConnectFn = (url, options) =>
  mqtt.connect(url, options) as unknown as MqttClientLike;

/**
 * Ensure the broker URL has a scheme. A bare host[:port] (e.g.
 * "broker.emqx.io") gets "mqtt://" so mqtt.js doesn't fail with
 * "Missing protocol".
 */
export function normalizeBrokerUrl(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `mqtt://${url}`;
}

export class MqttAgentRuntime {
  private readonly agent: MqttAgentConfig;
  private readonly engine: TagEngine;
  private readonly store: ConfigStore;
  private readonly logger?: Logger;

  private client?: MqttClientLike;
  /** Last published value/quality per tag — the agent-side deadband reference. */
  private lastValue = new Map<string, TagPrimitive | null>();
  private lastQuality = new Map<string, Quality>();
  /** Interval-mode timers, keyed by effective interval (ms). */
  private timers = new Map<number, NodeJS.Timeout>();
  private ended = false;

  private statusState: MqttAgentStatus["state"] = "connecting";
  private lastError: string | undefined;
  private publishedCount = 0;
  private lastPublishAt: number | undefined;

  constructor(options: MqttAgentRuntimeOptions) {
    this.agent = options.agent;
    this.engine = options.engine;
    this.store = options.store;
    this.logger = options.logger;

    if (!this.agent.enabled) {
      this.statusState = "disabled";
      return;
    }

    const connectFn = options.connectFn ?? defaultConnect;
    try {
      this.client = connectFn(normalizeBrokerUrl(this.agent.url), this.buildConnectOptions(options.dataDir));
    } catch (err) {
      this.statusState = "error";
      this.lastError = err instanceof Error ? err.message : String(err);
      this.logger?.error({ err, agent: this.agent.id }, "MQTT agent connect failed");
      return;
    }

    this.client.on("connect", () => {
      this.statusState = "connected";
      this.lastError = undefined;
      this.publishBirth();
      this.publishSnapshot();
      this.refreshTimers();
    });
    this.client.on("close", () => {
      if (!this.ended) this.statusState = "connecting";
    });
    this.client.on("error", (err: unknown) => {
      // mqtt.js keeps reconnecting after an error; record it but stay alive.
      this.lastError = err instanceof Error ? err.message : String(err);
      if (this.statusState !== "connected") this.statusState = "error";
    });

    this.engine.on("change", this.onTagChange);
    this.store.on("change", this.onConfigChange);
  }

  getStatus(): MqttAgentStatus {
    return {
      state: this.statusState,
      lastError: this.lastError,
      publishedCount: this.publishedCount,
      lastPublishAt: this.lastPublishAt,
    };
  }

  stop(): void {
    this.ended = true;
    this.statusState = "disabled";
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.engine.off("change", this.onTagChange);
    this.store.off("change", this.onConfigChange);
    this.client?.end(true);
  }

  // ---- connection setup ----

  private buildConnectOptions(dataDir?: string): IClientOptions {
    const agent = this.agent;
    const options: IClientOptions = {
      keepalive: agent.keepaliveSec,
      clean: agent.clean,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
    };
    if (agent.clientId) options.clientId = agent.clientId;
    if (agent.username !== undefined) options.username = agent.username;
    if (agent.password !== undefined) options.password = agent.password;
    const url = normalizeBrokerUrl(agent.url);
    if (url.startsWith("mqtts://") || url.startsWith("wss://")) {
      options.rejectUnauthorized = agent.tls.rejectUnauthorized;
      const readPem = (path: string) =>
        readFileSync(isAbsolute(path) || !dataDir ? path : resolve(dataDir, path));
      if (agent.tls.caPath) options.ca = readPem(agent.tls.caPath);
      if (agent.tls.certPath) options.cert = readPem(agent.tls.certPath);
      if (agent.tls.keyPath) options.key = readPem(agent.tls.keyPath);
    }
    if (agent.lwt.enabled && agent.lwt.topic) {
      options.will = {
        topic: agent.lwt.topic,
        payload: agent.lwt.offlinePayload,
        qos: agent.qos,
        retain: true,
      };
    }
    return options;
  }

  private publishBirth(): void {
    const { lwt, qos } = this.agent;
    if (!lwt.enabled || !lwt.topic || !this.client) return;
    this.client.publish(lwt.topic, lwt.onlinePayload, { qos, retain: true });
  }

  // ---- publishing ----

  private contextFor(tag: TagConfig): PublishContext {
    const device = this.store.getDevice(tag.deviceId);
    const channel = device ? this.store.getChannel(device.channelId) : undefined;
    return {
      channelId: channel?.id ?? "",
      channelName: channel?.name ?? "",
      deviceId: device?.id ?? tag.deviceId,
      deviceName: device?.name ?? tag.deviceId,
      tagId: tag.id,
      tagName: tag.name,
      dataType: tag.dataType,
    };
  }

  /**
   * Publish one tag if its effective config allows it. `force` skips the
   * deadband filter (used for the connect snapshot); quality changes always
   * bypass the deadband, matching tag-engine semantics.
   */
  private publishTag(tag: TagConfig, value: TagValue, force = false): void {
    if (!this.client) return;
    const resolved = resolvePublishConfig(this.agent, tag);
    if (!resolved) return;

    const qualityChanged = this.lastQuality.get(tag.id) !== value.quality;
    if (!force && !qualityChanged && !exceedsDeadband(this.lastValue.get(tag.id), value.value, resolved.deadband)) {
      return;
    }

    const ctx = this.contextFor(tag);
    const topic = renderTopic(resolved.topic, ctx);
    const payload = renderPayload(resolved.payloadFormat, resolved.payloadTemplate, ctx, value);
    this.client.publish(topic, payload, { qos: resolved.qos, retain: resolved.retain });

    this.lastValue.set(tag.id, value.value);
    this.lastQuality.set(tag.id, value.quality);
    this.publishedCount += 1;
    this.lastPublishAt = Date.now();
  }

  /** Publish every enabled tag's current value (on broker connect). */
  private publishSnapshot(): void {
    for (const tag of this.store.listTags()) {
      const value = this.engine.getValue(tag.id);
      if (value) this.publishTag(tag, value, true);
    }
  }

  private readonly onTagChange = (event: { tagId: string } & TagValue): void => {
    if (this.statusState !== "connected") return;
    const tag = this.engine.getConfig(event.tagId);
    if (!tag) return;
    const resolved = resolvePublishConfig(this.agent, tag);
    if (!resolved || resolved.mode !== "on-change") return;
    this.publishTag(tag, {
      value: event.value,
      quality: event.quality,
      timestamp: event.timestamp,
    });
  };

  // ---- interval mode ----

  /** (Re)build interval timers from the current effective per-tag intervals. */
  private refreshTimers(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    if (this.statusState !== "connected") return;

    const intervals = new Set<number>();
    for (const tag of this.store.listTags()) {
      const resolved = resolvePublishConfig(this.agent, tag);
      if (resolved?.mode === "interval") intervals.add(resolved.intervalMs);
    }
    for (const intervalMs of intervals) {
      this.timers.set(
        intervalMs,
        setInterval(() => this.publishIntervalGroup(intervalMs), intervalMs),
      );
    }
  }

  private publishIntervalGroup(intervalMs: number): void {
    // Skip while the broker connection is down — mqtt.js would otherwise
    // queue an unbounded backlog of stale interval publishes.
    if (!this.client?.connected) return;
    for (const tag of this.store.listTags()) {
      const resolved = resolvePublishConfig(this.agent, tag);
      if (!resolved || resolved.mode !== "interval" || resolved.intervalMs !== intervalMs) {
        continue;
      }
      const value = this.engine.getValue(tag.id);
      if (value) this.publishTag(tag, value, true);
    }
  }

  /** Config edits: interval groups may have changed (tag added/override edited). */
  private readonly onConfigChange = (): void => {
    this.refreshTimers();
  };
}
