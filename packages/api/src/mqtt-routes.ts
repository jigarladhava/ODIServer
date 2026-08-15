import { Router, type Request, type Response } from "express";
import type { ConfigStore } from "@odiserver/core";

/** Minimal status-provider interface so the API package doesn't depend on the server package. */
export interface MqttStatusProvider {
  getStatus(): unknown;
}

/**
 * MQTT agent CRUD at /api/mqtt-agents, plus live runtime status at
 * /api/mqtt-agents/status (published counts, connection state).
 */
export function mqttAgentRoutes(store: ConfigStore, mqtt?: MqttStatusProvider): Router {
  const router = Router();

  router.get("/status", (_req: Request, res: Response) => {
    res.json(mqtt?.getStatus() ?? {});
  });

  router.get("/", (_req: Request, res: Response) => {
    res.json(store.listMqttAgents());
  });

  router.get("/:id", (req: Request, res: Response) => {
    const agent = store.getMqttAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: "mqtt agent not found" });
    res.json(agent);
  });

  router.post("/", (req: Request, res: Response) => {
    try {
      res.status(201).json(store.upsertMqttAgent(req.body));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put("/:id", (req: Request, res: Response) => {
    try {
      res.json(store.upsertMqttAgent({ ...req.body, id: req.params.id }));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/:id", (req: Request, res: Response) => {
    if (!store.removeMqttAgent(req.params.id)) {
      return res.status(404).json({ error: "mqtt agent not found" });
    }
    res.status(204).end();
  });

  return router;
}
