import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ImporterPlugin } from "@odiserver/api";
import type { Logger } from "pino";

/**
 * Folder-based importer plugin discovery.
 *
 * Convention: `<pluginsDir>/<plugin-id>/plugin.json` with
 * `{ "id", "name", "main", "fileExtensions" }`, where `main` is an ESM module
 * whose default export implements `ImporterPlugin`. Anything broken (missing
 * manifest, import failure, wrong shape) is logged and skipped — a bad plugin
 * must never take the server down. No plugins directory => no importers =>
 * the UI hides third-party import formats entirely.
 */

interface PluginManifest {
  id: string;
  name: string;
  main: string;
  fileExtensions?: string[];
}

export function defaultPluginsDir(): string | undefined {
  if (process.env.ODISERVER_PLUGINS_DIR) return process.env.ODISERVER_PLUGINS_DIR;
  // packages/server/src/plugins -> <repo>/plugins (dev layout)
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = join(here, "..", "..", "..", "..", "plugins");
  return existsSync(candidate) ? candidate : undefined;
}

function isImporterPlugin(value: unknown): value is ImporterPlugin {
  const p = value as Partial<ImporterPlugin> | undefined;
  return (
    !!p &&
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.importProject === "function"
  );
}

export async function loadImporterPlugins(
  pluginsDir: string,
  logger?: Logger,
): Promise<ImporterPlugin[]> {
  if (!existsSync(pluginsDir)) return [];
  const entries = await readdir(pluginsDir, { withFileTypes: true });
  const plugins: ImporterPlugin[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(pluginsDir, entry.name);
    try {
      const manifest = JSON.parse(
        await readFile(join(dir, "plugin.json"), "utf8"),
      ) as Partial<PluginManifest>;
      if (typeof manifest.id !== "string" || typeof manifest.main !== "string") {
        throw new Error("plugin.json must define string 'id' and 'main'");
      }
      const mod: unknown = await import(pathToFileURL(join(dir, manifest.main)).href);
      const plugin = (mod as { default?: unknown }).default ?? mod;
      if (!isImporterPlugin(plugin)) {
        throw new Error("plugin main must default-export an ImporterPlugin");
      }
      plugins.push({
        id: manifest.id,
        name: typeof manifest.name === "string" ? manifest.name : plugin.name,
        fileExtensions: manifest.fileExtensions ?? plugin.fileExtensions ?? [".json"],
        importProject: (raw) => plugin.importProject(raw),
      });
      logger?.info({ plugin: manifest.id, dir }, "importer plugin loaded");
    } catch (err) {
      logger?.warn({ err, dir }, "skipping broken importer plugin");
    }
  }

  return plugins;
}
