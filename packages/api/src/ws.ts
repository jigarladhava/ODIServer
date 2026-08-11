import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { TagEngine, TagChangeEvent } from "@odiserver/core";

interface WsMessage {
  type: "snapshot" | "change";
  data: unknown;
}

/**
 * Tag live-value WebSocket at /ws. On connect, sends a full snapshot of
 * current values; afterwards broadcasts every tag change event.
 */
export function attachTagWebSocket(httpServer: HttpServer, engine: TagEngine): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const send = (ws: WebSocket, msg: WsMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  wss.on("connection", (ws) => {
    send(ws, { type: "snapshot", data: engine.getAllValues() });
  });

  engine.on("change", (event: TagChangeEvent) => {
    const msg: WsMessage = { type: "change", data: event };
    for (const client of wss.clients) send(client, msg);
  });

  return wss;
}
