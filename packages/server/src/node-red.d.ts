/**
 * Minimal typings for the embedded Node-RED runtime (node-red ships no TS types).
 * Only the surface ODIServer uses is declared here.
 */
declare module "node-red" {
  import type { Server as HttpServer } from "node:http";
  import type { RequestHandler } from "express";

  export interface NodeRedRuntime {
    init(server: HttpServer, settings: Record<string, unknown>): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    httpAdmin: RequestHandler;
    httpNode: RequestHandler;
    settings: Record<string, unknown>;
    nodes: {
      setFlows(flows: unknown[], deploymentType?: "full" | "flows" | "nodes"): Promise<{ rev: string }>;
      getFlows(): { flows: unknown[]; rev: string };
      getNode(id: string): unknown;
    };
    log: {
      info(msg: string): void;
      warn(msg: string): void;
      error(msg: string): void;
    };
  }

  const RED: NodeRedRuntime;
  export default RED;
}
