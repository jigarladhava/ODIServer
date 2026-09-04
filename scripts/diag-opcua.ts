/**
 * Live OPC UA connectivity diagnostic.
 *
 * Connects to a running OPC UA server (e.g. KEPServerEX) exactly the way the
 * embedded Node-RED client does — Sign/Basic256, anonymous, using the
 * node-red-contrib-opcua client certificate — then reads ServerStatus and any
 * nodeIds passed on the command line.
 *
 * Usage (from repo root):
 *   npx tsx scripts/diag-opcua.ts [endpointUrl] [nodeId ...]
 *
 * Defaults:
 *   endpointUrl  opc.tcp://10.20.112.115:49320
 *   nodeIds      ns=0;i=2256 (Server_ServerStatus)
 *
 * Browse mode: pass --browse <nodeId> [--depth N] to dump the address space
 * under a node instead of reading, e.g.
 *   npx tsx scripts/diag-opcua.ts --browse ns=2;s=A-Bhoapl --depth 2
 */
import {
  AttributeIds,
  MessageSecurityMode,
  OPCUAClient,
  OPCUACertificateManager,
  SecurityPolicy,
  UserTokenType,
} from "node-opcua";

const args = process.argv.slice(2);
let endpointUrl = "opc.tcp://10.20.112.115:49320";
let browseRoot: string | undefined;
let depth = 1;
const nodeIds: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--browse") browseRoot = args[++i];
  else if (args[i] === "--depth") depth = Number(args[++i]);
  else if (args[i].startsWith("opc.tcp://")) endpointUrl = args[i];
  else nodeIds.push(args[i]);
}
if (!browseRoot && nodeIds.length === 0) nodeIds.push("ns=0;i=2256");

// Same PKI the embedded Node-RED client nodes use, so cert trust matches production.
const clientCertificateManager = new OPCUACertificateManager({
  rootFolder: `${process.env.APPDATA}/node-red-opcua-nodejs/Config/PKI`,
  automaticallyAcceptUnknownCertificate: true,
});
await clientCertificateManager.initialize();

const client = OPCUAClient.create({
  securityMode: MessageSecurityMode.Sign,
  securityPolicy: SecurityPolicy.Basic256,
  clientCertificateManager,
  requestedSessionTimeout: 60000,
  connectionStrategy: { maxRetry: 0 },
  endpointMustExist: false,
});

try {
  console.log(`connecting ${endpointUrl} (Sign/Basic256, anonymous) ...`);
  await client.connect(endpointUrl);
  const session = await client.createSession({ type: UserTokenType.Anonymous });
  console.log("session created");

  if (browseRoot) {
    const browse = async (nodeId: string, d: number, prefix: string): Promise<void> => {
      const result = await session.browse({ nodeId, browseDirection: 0 });
      for (const ref of result.references ?? []) {
        console.log(`${prefix}${ref.browseName?.name ?? "?"}  [${ref.nodeId.toString()}]`);
        if (d > 0) await browse(ref.nodeId, d - 1, prefix + "  ");
      }
    };
    await browse(browseRoot, depth, "");
  } else {
    for (const nodeId of nodeIds) {
      try {
        const dv = await session.read({ nodeId, attributeId: AttributeIds.Value });
        console.log(nodeId, "=>", dv.statusCode.toString(), JSON.stringify(dv.value.value));
      } catch (err) {
        console.log(nodeId, "READ FAILED:", err instanceof Error ? err.message : String(err));
      }
    }
  }

  await session.close();
  await client.disconnect();
} catch (err) {
  console.error("FAILED:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
