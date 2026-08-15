import type { Logger } from "pino";
import type { ConfigStore, TagEngine } from "@odiserver/core";
import {
  MqttAgentRuntime,
  type MqttAgentStatus,
  type MqttConnectFn,
} from "./agent-runtime.js";

/**
 * Manages the set of running MQTT agents. Reconciles agent runtimes against
 * the config store (debounced): agents are started/stopped/restarted only
 * when their own configuration changes — tag edits are picked up by the
 * runtimes themselves, so they never force a broker reconnect.
 */

export interface MqttManagerOptions {
  engine: TagEngine;
  store: ConfigStore;
  logger?: Logger;
  connectFn?: MqttConnectFn;
  /** Base directory for resolving relative TLS certificate paths. */
  dataDir?: string;
}

export interface MqttAgentManager {
  getStatus(): Record<string, MqttAgentStatus>;
  stop(): void;
}

const RECONCILE_DEBOUNCE_MS = 250;

export function startMqttAgents(options: MqttManagerOptions): MqttAgentManager {
  const { engine, store, logger, connectFn, dataDir } = options;
  const runtimes = new Map<string, { fingerprint: string; runtime: MqttAgentRuntime }>();

  const reconcile = (): void => {
    let agents: ReturnType<ConfigStore["listMqttAgents"]>;
    try {
      agents = store.listMqttAgents();
    } catch (err) {
      logger?.error({ err }, "MQTT agent reconcile failed");
      return;
    }
    const seen = new Set<string>();
    for (const agent of agents) {
      seen.add(agent.id);
      const fingerprint = JSON.stringify(agent);
      const existing = runtimes.get(agent.id);
      if (existing && existing.fingerprint === fingerprint) continue;
      existing?.runtime.stop();
      runtimes.set(agent.id, {
        fingerprint,
        runtime: new MqttAgentRuntime({ agent, engine, store, logger, connectFn, dataDir }),
      });
      logger?.info({ agent: agent.id, url: agent.url }, "MQTT agent started");
    }
    for (const [id, entry] of runtimes) {
      if (!seen.has(id)) {
        entry.runtime.stop();
        runtimes.delete(id);
        logger?.info({ agent: id }, "MQTT agent stopped");
      }
    }
  };

  reconcile();

  let reconcileTimer: NodeJS.Timeout | undefined;
  const onConfigChange = (): void => {
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(reconcile, RECONCILE_DEBOUNCE_MS);
  };
  store.on("change", onConfigChange);

  return {
    getStatus() {
      const out: Record<string, MqttAgentStatus> = {};
      for (const [id, entry] of runtimes) out[id] = entry.runtime.getStatus();
      return out;
    },
    stop() {
      clearTimeout(reconcileTimer);
      store.off("change", onConfigChange);
      for (const entry of runtimes.values()) entry.runtime.stop();
      runtimes.clear();
    },
  };
}
