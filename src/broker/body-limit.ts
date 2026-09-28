import path from "node:path";
import { loadSettings } from "../settings.js";
import type { SwarmDb } from "../store/db.js";

/** Resolve from the database's project, not the caller's working directory. */
export function projectOf(dataDir: string): string {
  return path.resolve(dataDir, "../..");
}

/** The stated body limit (`bodyMaxChars`) for the project owning `dataDir`. */
export function bodyLimitIn(dataDir: string): number {
  return loadSettings(projectOf(dataDir)).settings.bodyMaxChars;
}

export function bodyLimit(db: SwarmDb): number {
  return bodyLimitIn(db.dataDir);
}
