import { Router, type Request, type Response } from "express";
import type { ConfigStore, TagEngine } from "@odiserver/core";

/**
 * Generic CRUD routes for one config entity kind (channel / device / tag).
 * Keeps the three route sets identical and small.
 */
export function entityRoutes(
  kind: "channel" | "device" | "tag",
  store: ConfigStore,
): Router {
  const router = Router();
  const cap = kind[0].toUpperCase() + kind.slice(1);

  // NOTE: keep method-call syntax on `store` so `this` stays bound.
  const storeAny = store as unknown as Record<string, (arg?: unknown) => unknown>;
  const listName = `list${cap}s`;
  const getName = `get${cap}`;
  const upsertName = `upsert${cap}`;
  const removeName = `remove${cap}`;

  router.get("/", (req: Request, res: Response) => {
    const parent = req.query.parent as string | undefined;
    res.json(storeAny[listName].call(store, parent));
  });

  router.get("/:id", (req: Request, res: Response) => {
    const item = storeAny[getName].call(store, req.params.id);
    if (!item) return res.status(404).json({ error: `${kind} not found` });
    res.json(item);
  });

  router.post("/", (req: Request, res: Response) => {
    try {
      const saved = storeAny[upsertName].call(store, req.body);
      res.status(201).json(saved);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put("/:id", (req: Request, res: Response) => {
    try {
      const saved = storeAny[upsertName].call(store, { ...req.body, id: req.params.id });
      res.json(saved);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/:id", (req: Request, res: Response) => {
    if (!storeAny[removeName].call(store, req.params.id)) {
      return res.status(404).json({ error: `${kind} not found` });
    }
    res.status(204).end();
  });

  return router;
}

/** Tag live-value routes (read current value, request write). */
export function valueRoutes(engine: TagEngine): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json(engine.getAllValues());
  });

  router.get("/:id", (req: Request, res: Response) => {
    const value = engine.getValue(req.params.id);
    if (!value) return res.status(404).json({ error: "tag not found" });
    res.json(value);
  });

  router.post("/:id/write", (req: Request, res: Response) => {
    try {
      engine.write(req.params.id, req.body?.value);
      res.status(202).json({ accepted: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
