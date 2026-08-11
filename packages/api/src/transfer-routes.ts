import { Router, type Request, type Response } from "express";
import {
  buildDeviceExport,
  csvToTags,
  parseDeviceExport,
  parseProject,
  tagsToCsv,
  type ConfigStore,
  type TagConfig,
} from "@odiserver/core";

/**
 * Import/export routes: project open/save, device bundles, and tag CSV.
 * All exports are JSON except tag CSV (text/csv); all set a
 * Content-Disposition filename so browsers save a sensible file.
 */

function sendDownload(res: Response, filename: string, body: string, contentType: string): void {
  res
    .status(200)
    .set({
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    })
    .send(body);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // Zod errors carry a readable issues list in err.message already.
    return err.message;
  }
  return String(err);
}

/** Project open/save: full-tree export and replace/merge import. */
export function projectTransferRoutes(store: ConfigStore): Router {
  const router = Router();

  router.get("/export", (_req: Request, res: Response) => {
    const project = store.getProject();
    const stamp = new Date().toISOString().slice(0, 10);
    sendDownload(res, `odiserver-project-${stamp}.json`, JSON.stringify(project, null, 2), "application/json");
  });

  router.post("/import", (req: Request, res: Response) => {
    const mode = req.query.mode === "merge" ? "merge" : "replace";
    try {
      const project = parseProject(req.body);
      if (mode === "merge") store.mergeProject(project);
      else store.replaceProject(project);
      res.json({
        mode,
        imported: {
          channels: project.channels.length,
          devices: project.devices.length,
          tags: project.tags.length,
        },
      });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  return router;
}

/** Device bundle export/import (device + its tags, portable across channels). */
export function deviceTransferRoutes(store: ConfigStore): Router {
  const router = Router();

  router.get("/:id/export", (req: Request, res: Response) => {
    const device = store.getDevice(req.params.id);
    if (!device) return res.status(404).json({ error: "device not found" });
    const bundle = buildDeviceExport(device, store.listTags(device.id));
    sendDownload(res, `device-${device.name}.json`, JSON.stringify(bundle, null, 2), "application/json");
  });

  router.post("/import", (req: Request, res: Response) => {
    try {
      const bundle = parseDeviceExport(req.body);
      // Target channel: explicit query param wins, else the bundle's own.
      const channelId = (req.query.channel as string | undefined) ?? bundle.device.channelId;
      if (!store.getChannel(channelId)) {
        return res.status(400).json({ error: `Unknown channel: ${channelId}` });
      }
      const device = { ...bundle.device, channelId };
      store.upsertDevice(device);
      const tags = bundle.tags.map((t) => ({ ...t, deviceId: device.id }));
      for (const tag of tags) store.upsertTag(tag);
      res.status(201).json({ device, imported: { tags: tags.length } });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  return router;
}

/** Tag export (CSV or JSON) and CSV/JSON import into a device. */
export function tagTransferRoutes(store: ConfigStore): Router {
  const router = Router();

  router.get("/export", (req: Request, res: Response) => {
    const deviceId = req.query.device as string | undefined;
    if (!deviceId) return res.status(400).json({ error: "device query parameter is required" });
    const device = store.getDevice(deviceId);
    if (!device) return res.status(404).json({ error: "device not found" });
    const tags = store.listTags(deviceId);
    const format = req.query.format === "json" ? "json" : "csv";
    if (format === "json") {
      sendDownload(res, `tags-${device.name}.json`, JSON.stringify(tags, null, 2), "application/json");
    } else {
      sendDownload(res, `tags-${device.name}.csv`, tagsToCsv(tags), "text/csv; charset=utf-8");
    }
  });

  router.post("/import", (req: Request, res: Response) => {
    const deviceId = req.query.device as string | undefined;
    if (!deviceId) return res.status(400).json({ error: "device query parameter is required" });
    if (!store.getDevice(deviceId)) return res.status(404).json({ error: "device not found" });
    try {
      const contentType = String(req.headers["content-type"] ?? "");
      let tags: TagConfig[];
      if (contentType.includes("text/csv")) {
        tags = csvToTags(String(req.body ?? ""), deviceId);
      } else {
        // JSON: accept a bare array of tag configs.
        const raw = req.body;
        if (!Array.isArray(raw)) {
          return res.status(400).json({ error: "expected a JSON array of tags or text/csv body" });
        }
        tags = raw.map((t) => {
          const parsed = { ...(t as Record<string, unknown>), deviceId };
          return parsed as TagConfig;
        });
        // Validate through the store (schema parse happens in upsertTag).
      }
      for (const tag of tags) store.upsertTag(tag);
      res.status(201).json({ imported: { tags: tags.length } });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  return router;
}
