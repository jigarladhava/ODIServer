import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import RED from "node-red";
import type { ConfigStore, TagEngine } from "@odiserver/core";
import { generateFlows, type NodeRedNode } from "@odiserver/drivers";

const require = createRequire(import.meta.url);

/** Directory containing the odi-tag-in bridge node module. */
export function bridgeNodesDir(): string {
  const driversPkg = require.resolve("@odiserver/drivers/package.json");
  return join(dirname(driversPkg), "nodered");
}

export interface EmbeddedNodeRedOptions {
  httpServer: HttpServer;
  nodeRedDir: string;
  engine: TagEngine;
  store: ConfigStore;
}

/** Load or generate the Node-RED credential secret (kept stable across restarts). */
function credentialSecret(nodeRedDir: string): string {
  if (process.env.ODISERVER_CREDENTIAL_SECRET) return process.env.ODISERVER_CREDENTIAL_SECRET;
  const secretFile = join(nodeRedDir, ".credential-secret");
  if (existsSync(secretFile)) return readFileSync(secretFile, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

/**
 * Initialize and start the embedded Node-RED runtime.
 * The editor is not mounted (headless); flows are generated from the
 * ODIServer configuration and deployed programmatically.
 */
export async function startEmbeddedNodeRed(options: EmbeddedNodeRedOptions): Promise<void> {
  const { httpServer, nodeRedDir, engine, store } = options;

  const settings: Record<string, unknown> = {
    httpAdminRoot: "/_red", // not mounted — editor disabled
    httpNodeRoot: false,
    userDir: nodeRedDir,
    nodesDir: [bridgeNodesDir()],
    disableEditor: true,
    flowFile: "flows.json",
    flowFilePretty: true,
    credentialSecret: credentialSecret(nodeRedDir),
    functionGlobalContext: {},
    // Custom key consumed by the odi-tag-in bridge node via RED.settings
    odiRuntime: { engine, store },
    logging: {
      console: { level: "warn", metrics: false, audit: false },
    },
  };

  RED.init(httpServer, settings);
  await RED.start();
  await waitForInitialFlowLoad();
}

/**
 * Node-RED's runtime start() does NOT await its initial loadFlows() — the
 * storage load completes asynchronously afterwards and would clobber any
 * flows we deploy in between. Poll until the initial load has landed
 * (a revision exists) before deploying our generated flows.
 */
async function waitForInitialFlowLoad(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { rev } = RED.nodes.getFlows();
      if (rev) return;
    } catch {
      /* runtime not ready yet */
    }
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error("Timed out waiting for Node-RED initial flow load");
}

/** Regenerate flows from the current config and deploy them (full replace). */
export async function deployDriverFlows(store: ConfigStore): Promise<void> {
  const flows: NodeRedNode[] = generateFlows(store.getProject());
  await RED.nodes.setFlows(flows as unknown[], "full");
}

export async function stopEmbeddedNodeRed(): Promise<void> {
  await RED.stop();
}
