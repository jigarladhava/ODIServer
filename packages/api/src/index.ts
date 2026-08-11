import express, { type Express, type Request, type Response } from "express";
import type { Server as HttpServer } from "node:http";
import type { ConfigStore, TagEngine } from "@odiserver/core";
import { entityRoutes, valueRoutes } from "./routes.js";
import { deviceTransferRoutes, projectTransferRoutes, tagTransferRoutes } from "./transfer-routes.js";
import { attachTagWebSocket } from "./ws.js";

export interface ApiOptions {
  store: ConfigStore;
  engine: TagEngine;
  /** Static dir for the built web console (optional). */
  webDistDir?: string;
  startedAt?: number;
}

/** Build the ODIServer Express app (REST + static web console). */
export function createApiApp(options: ApiOptions): Express {
  const { store, engine, webDistDir } = options;
  const app = express();
  app.use(express.json());
  // Tag CSV import posts a text/csv body.
  app.use(express.text({ type: ["text/csv", "text/plain"], limit: "5mb" }));

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
    res.json(store.getProject());
  });

  // Transfer routes must be mounted before the generic entity routes so
  // literal paths like /api/tags/export are not captured by "/:id".
  app.use("/api/project", projectTransferRoutes(store));
  app.use("/api/devices", deviceTransferRoutes(store));
  app.use("/api/tags", tagTransferRoutes(store));
  app.use("/api/channels", entityRoutes("channel", store));
  app.use("/api/devices", entityRoutes("device", store));
  app.use("/api/tags", entityRoutes("tag", store));
  app.use("/api/values", valueRoutes(engine));

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
