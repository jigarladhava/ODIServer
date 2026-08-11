import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Resolve the ODIServer data directory, cross-platform:
 *   1. ODISERVER_DATA_DIR env override (used by installers/services)
 *   2. ./data when running from the dev repo (root package.json named "odiserver")
 *   3. Platform convention: %PROGRAMDATA%\ODIServer, /var/lib/odiserver,
 *      ~/Library/Application Support/ODIServer
 */
export function resolveDataDir(cwd = process.cwd()): string {
  if (process.env.ODISERVER_DATA_DIR) return resolve(process.env.ODISERVER_DATA_DIR);

  // Walk up from cwd looking for the dev repo root (package.json named "odiserver").
  let dir = resolve(cwd);
  for (;;) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "odiserver") return join(dir, "data");
      } catch {
        /* keep walking up */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  switch (platform()) {
    case "win32":
      return join(process.env.PROGRAMDATA ?? "C:\\ProgramData", "ODIServer");
    case "darwin":
      return join(homedir(), "Library", "Application Support", "ODIServer");
    default:
      return "/var/lib/odiserver";
  }
}

export function ensureDataDirs(dataDir: string): { dbPath: string; nodeRedDir: string; certsDir: string } {
  const nodeRedDir = join(dataDir, "nodered");
  const certsDir = join(dataDir, "certs");
  for (const dir of [dataDir, nodeRedDir, certsDir]) mkdirSync(dir, { recursive: true });
  return { dbPath: join(dataDir, "odiserver.db"), nodeRedDir, certsDir };
}
