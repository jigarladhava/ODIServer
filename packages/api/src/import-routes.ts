import { Router, type Request, type Response } from "express";
import express from "express";
import { parseProject, type ConfigStore } from "@odiserver/core";
import type { ImporterPlugin } from "./importers.js";

/**
 * Routes for importer plugins: list the available third-party import formats
 * and import a project file through one of them. The file body is posted raw
 * (text) because formats like the KEPServerEX export can exceed the default
 * JSON body limit by an order of magnitude.
 */
export function importerRoutes(store: ConfigStore, importers: ImporterPlugin[]): Router {
  const router = Router();
  const byId = new Map(importers.map((p) => [p.id, p]));

  router.get("/plugins/importers", (_req: Request, res: Response) => {
    res.json(
      importers.map((p) => ({ id: p.id, name: p.name, fileExtensions: p.fileExtensions })),
    );
  });

  router.post(
    "/project/import-plugin/:pluginId",
    express.text({ type: () => true, limit: "30mb" }),
    (req: Request, res: Response) => {
      const plugin = byId.get(req.params.pluginId);
      if (!plugin) return res.status(404).json({ error: `Unknown importer: ${req.params.pluginId}` });
      const mode = req.query.mode === "merge" ? "merge" : "replace";
      try {
        const { project: converted, warnings } = plugin.importProject(String(req.body ?? ""));
        const project = parseProject(converted);
        if (mode === "merge") store.mergeProject(project);
        else store.replaceProject(project);
        res.json({
          mode,
          imported: {
            channels: project.channels.length,
            devices: project.devices.length,
            tags: project.tags.length,
          },
          warnings,
        });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  return router;
}
