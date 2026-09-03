import { Router, type Request, type Response } from "express";
import { EVENT_SEVERITIES, type EventLog, type EventSeverity } from "@odiserver/core";

const MAX_LIMIT = 2000;
const DEFAULT_LIMIT = 500;

/**
 * Event log routes: GET / returns buffered server events in chronological
 * order. Query params: limit (max 2000, default 500), since (epoch ms),
 * severity, source.
 */
export function eventRoutes(eventLog: EventLog): Router {
  const router = Router();

  router.get("/", (req: Request, res: Response) => {
    // Absent, empty, non-numeric, or non-positive limits fall back to the
    // default (Number("") === 0 would otherwise silently clamp to 1).
    const rawLimit = req.query.limit as string | undefined;
    const parsedLimit = rawLimit === undefined || rawLimit === "" ? Number.NaN : Number(rawLimit);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(MAX_LIMIT, Math.trunc(parsedLimit))
        : DEFAULT_LIMIT;

    const rawSince = Number(req.query.since);
    const since = Number.isFinite(rawSince) ? rawSince : undefined;

    const severity = req.query.severity as EventSeverity | undefined;
    if (severity !== undefined && !(EVENT_SEVERITIES as readonly string[]).includes(severity)) {
      return res.status(400).json({ error: `invalid severity: ${String(req.query.severity)}` });
    }

    const source = req.query.source as string | undefined;

    res.json(eventLog.list({ limit, since, severity, source }));
  });

  return router;
}
