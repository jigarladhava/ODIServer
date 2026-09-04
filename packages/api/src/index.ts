import express, { type Express, type Request, type Response } from "express";
import type { Server as HttpServer } from "node:http";
import type { ConfigStore, EventLog, TagEngine } from "@odiserver/core";
import { entityRoutes, valueRoutes } from "./routes.js";
import { eventRoutes } from "./event-routes.js";
import { deviceTransferRoutes, projectTransferRoutes, tagTransferRoutes } from "./transfer-routes.js";
import { importerRoutes } from "./import-routes.js";
import type { ImporterPlugin } from "./importers.js";
import { mqttAgentRoutes, redactMqttAgent, type MqttStatusProvider } from "./mqtt-routes.js";
import { attachTagWebSocket } from "./ws.js";

export type { ImporterPlugin } from "./importers.js";

export interface ApiOptions {
  store: ConfigStore;
  engine: TagEngine;
  /** Static dir for the built web console (optional). */
  webDistDir?: string;
  startedAt?: number;
  /** Northbound MQTT agent manager (optional; enables /api/mqtt-agents/status). */
  mqtt?: MqttStatusProvider;
  /** Importer plugins discovered at runtime (optional; enables /api/plugins/importers). */
  importers?: ImporterPlugin[];
  /** Server event log (optional; enables /api/events). */
  events?: EventLog;
  /**
   * Bearer token required for all /api routes. Defaults to the
   * ODISERVER_API_TOKEN env var; when unset the gate is disabled.
   */
  apiToken?: string;
}

/** Build the ODIServer Express app (REST + static web console). */
export function createApiApp(options: ApiOptions): Express {
  const { store, engine, webDistDir } = options;
  const app = express();
  // Bearer-token gate: every /api request must present the configured token.
  const apiToken = options.apiToken ?? process.env.ODISERVER_API_TOKEN;
  if (apiToken) {
    app.use("/api", (req: Request, res: Response, next: () => void) => {
      if (req.headers.authorization === `Bearer ${apiToken}`) return next();
      res.status(401).json({ error: "unauthorized" });
    });
  }
  // Full-project imports of converted Kepware projects run to several MB
  // (13k+ tags), well past the 100kb default — give JSON bodies headroom.
  app.use(express.json({ limit: "30mb" }));
  // Tag CSV import posts a text/csv body. Skip the project importer path —
  // it mounts its own text parser with a larger limit (see import-routes.ts).
  const csvTextParser = express.text({ type: ["text/csv", "text/plain"], limit: "5mb" });
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/project/import-plugin/")) return next();
    csvTextParser(req, res, next);
  });

  app.get("/api/status", (_req: Request, res: Response) => {
    res.json({
      status: "running",
      uptimeMs: Date.now() - (options.startedAt ?? Date.now()),
      counts: {
        channels: store.listChannels().length,
        devices: store.listDevices().length,
        tags: store.listTags().length,
      },
    });
  });

  app.get("/api/project", (_req: Request, res: Response) => {
    const project = store.getProject();
    res.json({ ...project, mqttAgents: project.mqttAgents.map(redactMqttAgent) });
  });

  // Transfer routes must be mounted before the generic entity routes so
  // literal paths like /api/tags/export are not captured by "/:id".
  app.use("/api/project", projectTransferRoutes(store));
  app.use("/api", importerRoutes(store, options.importers ?? []));
  app.use("/api/devices", deviceTransferRoutes(store));
  app.use("/api/tags", tagTransferRoutes(store));
  app.use("/api/channels", entityRoutes("channel", store));
  app.use("/api/devices", entityRoutes("device", store));
  app.use("/api/tags", entityRoutes("tag", store));
  app.use("/api/mqtt-agents", mqttAgentRoutes(store, options.mqtt));
  app.use("/api/values", valueRoutes(engine));
  if (options.events) app.use("/api/events", eventRoutes(options.events));

  if (webDistDir) {
    app.use(express.static(webDistDir));
    // SPA fallback (non-API GETs go to index.html)
    app.get(/^(?!\/api|\/ws).*/, (_req: Request, res: Response) => {
      res.sendFile("index.html", { root: webDistDir });
    });
  }

  return app;
}

/** Attach the tag WebSocket to an existing HTTP server. */
export { attachTagWebSocket };
