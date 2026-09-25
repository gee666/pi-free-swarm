import path from "node:path";
import { loadSettings } from "../settings.js";
import type { SwarmDb } from "../store/db.js";

/** Resolve from the database's project, not the caller's working directory. */
export function bodyLimit(db: SwarmDb): number {
  return loadSettings(path.resolve(db.dataDir, "../..")).settings.bodyMaxChars;
}
