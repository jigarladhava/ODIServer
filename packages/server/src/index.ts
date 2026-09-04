import { createServer, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import pino, { type Logger } from "pino";
import { ConfigStore, EventLog, TagEngine, type Quality } from "@odiserver/core";
import { attachTagWebSocket, createApiApp } from "@odiserver/api";
import { ensureDataDirs, resolveDataDir } from "./datadir.js";
import { deployDriverFlows, startEmbeddedNodeRed, stopEmbeddedNodeRed } from "./nodered.js";
import { startOpcUaServer, type OpcUaServerHandle } from "./opcua-server.js";
import { startMqttAgents, type MqttAgentManager } from "./mqtt/manager.js";
import { defaultPluginsDir, loadImporterPlugins } from "./plugins/loader.js";

export interface OdiServerHandle {
  httpServer: HttpServer;
  store: ConfigStore;
  engine: TagEngine;
  events: EventLog;
  port: number;
  dataDir: string;
  opcua: OpcUaServerHandle | undefined;
  mqtt: MqttAgentManager;
  stop(): Promise<void>;
}

export interface OdiServerOptions {
  port?: number;
  /**
   * HTTP bind address. Defaults to ODISERVER_HOST, then loopback — set
   * ODISERVER_HOST=0.0.0.0 explicitly to expose the API on the network.
   */
  host?: string;
  dataDir?: string;
  logger?: Logger;
  /** Northbound OPC UA server; enabled on port 49320 by default. */
  opcua?: { enabled?: boolean; port?: number };
}

function defaultWebDistDir(): string | undefined {
  // packages/server/src -> packages/web/dist (dev layout)
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = join(here, "..", "..", "web", "dist");
  return existsSync(candidate) ? candidate : undefined;
}

/** Boot the full ODIServer: config store, tag engine, REST/WS API, embedded Node-RED. */
export async function startOdiServer(options: OdiServerOptions = {}): Promise<OdiServerHandle> {
  const logger = options.logger ?? pino({ name: "odiserver" });
  const port = options.port ?? Number(process.env.ODISERVER_PORT ?? 8080);
  const host = options.host ?? process.env.ODISERVER_HOST ?? "127.0.0.1";
  const apiToken = process.env.ODISERVER_API_TOKEN;
  if (!apiToken) {
    logger.warn(
      "ODISERVER_API_TOKEN is not set — the REST/WS API is unauthenticated; set it before exposing the server",
    );
  }
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    logger.warn({ host }, "ODIServer API binding to a non-loopback interface");
  }
  const dataDir = options.dataDir ?? resolveDataDir();
  const { dbPath, nodeRedDir } = ensureDataDirs(dataDir);

  const store = new ConfigStore(dbPath);
  const engine = new TagEngine();
  engine.load(store.listTags());
  const events = new EventLog();

  // Northbound MQTT agents. Connections are async and self-healing; a broker
  // being unreachable must never take the rest of the server down.
  const mqtt = startMqttAgents({ engine, store, logger, dataDir, events });

  // Optional importer plugins (e.g. plugins/kepserver-import). Absent plugins
  // directory simply means no third-party import formats are offered.
  const pluginsDir = defaultPluginsDir();
  const importers = pluginsDir ? await loadImporterPlugins(pluginsDir, logger) : [];

  const app = createApiApp({
    store,
    engine,
    webDistDir: defaultWebDistDir(),
    startedAt: Date.now(),
    mqtt,
    importers,
    events,
    apiToken,
  });
  const httpServer = createServer(app);
  attachTagWebSocket(httpServer, engine, events, apiToken);

  // ---- event log wiring -------------------------------------------------

  // Config mutations arrive one event per entity; bulk imports would flood
  // the log, so coalesce a short window into summary lines.
  let configBurst: { kind: string; action: string; count: number }[] = [];
  let configBurstTimer: NodeJS.Timeout | undefined;
  const flushConfigBurst = (): void => {
    for (const entry of configBurst) {
      events.info(
        "config",
        entry.count === 1
          ? `${entry.kind} ${entry.action === "upsert" ? "saved" : "removed"}`
          : `${entry.count} ${entry.kind}s ${entry.action === "upsert" ? "saved" : "removed"}`,
      );
    }
    configBurst = [];
  };
  store.on("change", (e) => {
    const existing = configBurst.find((b) => b.kind === e.kind && b.action === e.action);
    if (existing) existing.count += 1;
    else configBurst.push({ kind: e.kind, action: e.action, count: 1 });
    clearTimeout(configBurstTimer);
    configBurstTimer = setTimeout(flushConfigBurst, 250);
  });

  // Tag quality transitions (device comm failures and recovery). Value-only
  // changes are far too chatty for an event log and are ignored here.
  // Transitions are coalesced per device over a short window so one device
  // outage (all its tags flipping at once) logs a summary, not one line
  // per tag.
  const lastLoggedQuality = new Map<string, Quality>();
  interface QualityBurstEntry {
    deviceLabel: string;
    quality: Quality;
    error?: string;
    tagNames: string[];
  }
  const qualityBurst = new Map<string, QualityBurstEntry>();
  let qualityBurstTimer: NodeJS.Timeout | undefined;
  const flushQualityBurst = (): void => {
    for (const entry of qualityBurst.values()) {
      const detail = entry.error ? `: ${entry.error}` : "";
      const message =
        entry.tagNames.length === 1
          ? entry.quality === "good"
            ? `Tag ${entry.tagNames[0]} recovered (quality good)`
            : `Tag ${entry.tagNames[0]} quality ${entry.quality}${detail}`
          : entry.quality === "good"
            ? `Device ${entry.deviceLabel}: ${entry.tagNames.length} tags recovered (quality good)`
            : `Device ${entry.deviceLabel}: ${entry.tagNames.length} tags quality ${entry.quality}${detail}`;
      if (entry.quality === "good") events.info("device", message);
      else if (entry.quality === "bad") events.error("device", message);
      else events.warning("device", message);
    }
    qualityBurst.clear();
  };
  engine.on("change", (e) => {
    const prev = lastLoggedQuality.get(e.tagId);
    if (prev === e.quality) return;
    lastLoggedQuality.set(e.tagId, e.quality);
    if (e.quality === "good" && prev === undefined) return;
    const config = engine.getConfig(e.tagId);
    const device = config ? store.getDevice(config.deviceId) : undefined;
    const label = config ? `${device?.name ?? config.deviceId}.${config.name}` : e.tagId;
    const key = `${device?.id ?? ""}|${e.quality}|${e.error ?? ""}`;
    const entry = qualityBurst.get(key);
    if (entry) entry.tagNames.push(label);
    else {
      qualityBurst.set(key, {
        deviceLabel: device?.name ?? "",
        quality: e.quality,
        error: e.error,
        tagNames: [label],
      });
    }
    clearTimeout(qualityBurstTimer);
    qualityBurstTimer = setTimeout(flushQualityBurst, 500);
  });

  engine.on("write", (req) => {
    const config = engine.getConfig(req.tagId);
    events.info("device", `Write requested: ${config?.name ?? req.tagId} = ${String(req.value)}`);
  });

  // -----------------------------------------------------------------------

  // Config changes: reload tag engine and redeploy driver flows (debounced).
  let redeployTimer: NodeJS.Timeout | undefined;
  store.on("change", () => {
    engine.load(store.listTags());
    // Prune quality-tracking entries for tags that no longer exist.
    for (const tagId of lastLoggedQuality.keys()) {
      if (!engine.getConfig(tagId)) lastLoggedQuality.delete(tagId);
    }
    clearTimeout(redeployTimer);
    redeployTimer = setTimeout(() => {
      deployDriverFlows(store).catch((err) => logger.error({ err }, "flow redeploy failed"));
    }, 500);
  });

  await new Promise<void>((resolveListen) => httpServer.listen(port, host, resolveListen));
  logger.info({ port, host, dataDir }, "ODIServer API listening");
  events.info("server", `ODIServer API listening on ${host}:${port}`);

  await startEmbeddedNodeRed({ httpServer, nodeRedDir, engine, store });
  logger.info("embedded Node-RED started");
  events.info("server", "Embedded Node-RED runtime started");

  await deployDriverFlows(store);
  logger.info("driver flows deployed");
  events.info("server", "Driver flows deployed");

  // Northbound OPC UA server (browse tree). A bind failure
  // (e.g. port already in use) must not take the HTTP API down with it.
  let opcua: OpcUaServerHandle | undefined;
  const opcuaEnabled = options.opcua?.enabled ?? true;
  if (opcuaEnabled) {
    const opcuaPort = options.opcua?.port ?? Number(process.env.ODISERVER_OPCUA_PORT ?? 49320);
    try {
      opcua = await startOpcUaServer({
        engine,
        store,
        port: opcuaPort,
        certsDir: join(dataDir, "certs"),
        logger,
      });
      events.info("opcua", `OPC UA server listening on port ${opcuaPort}`);
    } catch (err) {
      logger.error({ err, opcuaPort }, "OPC UA server failed to start");
      events.error(
        "opcua",
        `OPC UA server failed to start on port ${opcuaPort}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    httpServer,
    store,
    engine,
    events,
    port,
    dataDir,
    opcua,
    mqtt,
    async stop() {
      clearTimeout(redeployTimer);
      clearTimeout(configBurstTimer);
      clearTimeout(qualityBurstTimer);
      mqtt.stop();
      await opcua?.stop().catch((err) => logger.error({ err }, "OPC UA server shutdown failed"));
      await stopEmbeddedNodeRed();
      await new Promise<void>((res, rej) =>
        httpServer.close((err) => (err ? rej(err) : res())),
      );
      store.close();
    },
  };
}
