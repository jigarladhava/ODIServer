import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadImporterPlugins } from "../src/plugins/loader.js";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "odi-plugins-"));

  // Valid plugin.
  await mkdir(join(dir, "good"), { recursive: true });
  await writeFile(
    join(dir, "good", "plugin.json"),
    JSON.stringify({ id: "good", name: "Good Format", main: "main.js", fileExtensions: [".g"] }),
  );
  await writeFile(
    join(dir, "good", "main.js"),
    `export default { id: "good", name: "Good Format", fileExtensions: [".g"],
       importProject: (raw) => ({ project: { channels: [], devices: [], tags: [] }, warnings: [raw] }) };`,
  );

  // Broken: manifest missing "main".
  await mkdir(join(dir, "bad-manifest"), { recursive: true });
  await writeFile(join(dir, "bad-manifest", "plugin.json"), JSON.stringify({ id: "bad" }));

  // Broken: module throws on import.
  await mkdir(join(dir, "bad-module"), { recursive: true });
  await writeFile(
    join(dir, "bad-module", "plugin.json"),
    JSON.stringify({ id: "bad-module", name: "Bad", main: "main.js" }),
  );
  await writeFile(join(dir, "bad-module", "main.js"), `throw new Error("boom");`);

  // A stray file (not a directory) must be ignored.
  await writeFile(join(dir, "README.txt"), "not a plugin");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadImporterPlugins", () => {
  it("loads valid plugins and skips broken ones", async () => {
    const plugins = await loadImporterPlugins(dir);
    expect(plugins.map((p) => p.id)).toEqual(["good"]);
    const result = plugins[0].importProject("hi");
    expect(result.warnings).toEqual(["hi"]);
    expect(plugins[0].fileExtensions).toEqual([".g"]);
  });

  it("returns an empty list when the directory does not exist", async () => {
    expect(await loadImporterPlugins(join(dir, "does-not-exist"))).toEqual([]);
  });
});
