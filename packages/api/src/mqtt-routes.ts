import { Router, type Request, type Response } from "express";
import type { ConfigStore, MqttAgentConfig } from "@odiserver/core";

/** API-view redaction: broker passwords are write-only, never returned. */
export function redactMqttAgent(agent: MqttAgentConfig): MqttAgentConfig {
  return { ...agent, password: "" };
}

/** Minimal status-provider interface so the API package doesn't depend on the server package. */
export interface MqttStatusProvider {
  getStatus(): unknown;
  /** One-shot broker connectivity probe; optional (404s when unavailable). */
  testConnection?(config: unknown): Promise<{ ok: boolean; error?: string; latencyMs?: number }>;
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

  // Broker connectivity probe for the console's "Test connection" button.
  // Mounted before "/:id" so the literal path wins.
  router.post("/test", async (req: Request, res: Response) => {
    if (!mqtt?.testConnection) {
      return res.status(501).json({ error: "connection testing is not available" });
    }
    try {
      res.json(await mqtt.testConnection(req.body));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/", (_req: Request, res: Response) => {
    res.json(store.listMqttAgents().map(redactMqttAgent));
  });

  router.get("/:id", (req: Request, res: Response) => {
    const agent = store.getMqttAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: "mqtt agent not found" });
    res.json(redactMqttAgent(agent));
  });

  router.post("/", (req: Request, res: Response) => {
    try {
      res.status(201).json(redactMqttAgent(store.upsertMqttAgent(req.body)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put("/:id", (req: Request, res: Response) => {
    try {
      const body = { ...req.body, id: req.params.id };
      // The console never echoes stored passwords back to the editor; an
      // omitted password on update means "keep the existing one".
      if (body.password === undefined) {
        const existing = store.getMqttAgent(req.params.id);
        if (existing?.password !== undefined) body.password = existing.password;
      }
      res.json(redactMqttAgent(store.upsertMqttAgent(body)));
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
