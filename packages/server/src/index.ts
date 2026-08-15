import { createServer, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import pino, { type Logger } from "pino";
import { ConfigStore, TagEngine } from "@odiserver/core";
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
  port: number;
  dataDir: string;
  opcua: OpcUaServerHandle | undefined;
  mqtt: MqttAgentManager;
  stop(): Promise<void>;
}

export interface OdiServerOptions {
  port?: number;
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
  const dataDir = options.dataDir ?? resolveDataDir();
  const { dbPath, nodeRedDir } = ensureDataDirs(dataDir);

  const store = new ConfigStore(dbPath);
  const engine = new TagEngine();
  engine.load(store.listTags());

  // Northbound MQTT agents. Connections are async and self-healing; a broker
  // being unreachable must never take the rest of the server down.
  const mqtt = startMqttAgents({ engine, store, logger, dataDir });

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
  });
  const httpServer = createServer(app);
  attachTagWebSocket(httpServer, engine);

  // Config changes: reload tag engine and redeploy driver flows (debounced).
  let redeployTimer: NodeJS.Timeout | undefined;
  store.on("change", () => {
    engine.load(store.listTags());
    clearTimeout(redeployTimer);
    redeployTimer = setTimeout(() => {
      deployDriverFlows(store).catch((err) => logger.error({ err }, "flow redeploy failed"));
    }, 500);
  });

  await new Promise<void>((resolveListen) => httpServer.listen(port, resolveListen));
  logger.info({ port, dataDir }, "ODIServer API listening");

  await startEmbeddedNodeRed({ httpServer, nodeRedDir, engine, store });
  logger.info("embedded Node-RED started");

  await deployDriverFlows(store);
  logger.info("driver flows deployed");

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
    } catch (err) {
      logger.error({ err, opcuaPort }, "OPC UA server failed to start");
    }
  }

  return {
    httpServer,
    store,
    engine,
    port,
    dataDir,
    opcua,
    mqtt,
    async stop() {
      clearTimeout(redeployTimer);
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
