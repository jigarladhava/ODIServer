/**
 * Importer plugin contract.
 *
 * An importer plugin converts a third-party project file (e.g. a KEPServerEX
 * JSON export) into an ODIServer project tree. Plugins are discovered at
 * runtime from a plugins directory by the server (see
 * packages/server/src/plugins/loader.ts); the API only sees the contract.
 */
export interface ImporterPlugin {
  /** Stable plugin id, e.g. "kepserver-import". */
  id: string;
  /** Human-readable format name shown in the UI, e.g. "KEPServerEX Project (JSON)". */
  name: string;
  /** Accepted file extensions, e.g. [".json"]. */
  fileExtensions: string[];
  /**
   * Convert a raw file body into an ODIServer project (as accepted by
   * `parseProject`) plus human-readable warnings about skipped or degraded
   * content. Throws an Error with a readable message on invalid input.
   */
  importProject(raw: string): { project: unknown; warnings: string[] };
}
