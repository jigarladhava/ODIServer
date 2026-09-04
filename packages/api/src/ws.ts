import { WebSocketServer, WebSocket, type VerifyClientCallbackAsync } from "ws";
import type { Server as HttpServer } from "node:http";
import type { EventLog, ServerEvent, TagEngine, TagChangeEvent } from "@odiserver/core";

interface WsMessage {
  type: "snapshot" | "change" | "event";
  data: unknown;
}

/**
 * Tag live-value WebSocket at /ws. On connect, sends a full snapshot of
 * current values; afterwards broadcasts every tag change event. When an
 * EventLog is provided, server events are broadcast too.
 *
 * When `apiToken` is set (ODISERVER_API_TOKEN), upgrade requests must
 * authenticate via `Authorization: Bearer <token>` or a `?token=` query
 * parameter (browsers cannot set headers on WebSocket).
 */
export function attachTagWebSocket(
  httpServer: HttpServer,
  engine: TagEngine,
  eventLog?: EventLog,
  apiToken?: string,
): WebSocketServer {
  const token = apiToken ?? process.env.ODISERVER_API_TOKEN;
  const verifyClient: VerifyClientCallbackAsync | undefined = token
    ? (info, done) => {
        const header = info.req.headers.authorization;
        const queryToken = info.req.url
          ? new URL(info.req.url, "http://localhost").searchParams.get("token")
          : null;
        if (header === `Bearer ${token}` || queryToken === token) return done(true);
        done(false, 401, "unauthorized");
      }
    : undefined;
  const wss = new WebSocketServer({ server: httpServer, path: "/ws", verifyClient });

  const send = (ws: WebSocket, msg: WsMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const broadcast = (msg: WsMessage) => {
    // Serialize once — not once per client.
    const payload = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  };

  wss.on("connection", (ws) => {
    send(ws, { type: "snapshot", data: engine.getAllValues() });
  });

  engine.on("change", (event: TagChangeEvent) => {
    broadcast({ type: "change", data: event });
  });

  eventLog?.on("event", (event: ServerEvent) => {
    broadcast({ type: "event", data: event });
  });

  return wss;
}
