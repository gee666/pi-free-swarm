import type { SwarmDb } from "../store/db.js";
import { projectOf } from "../broker/project-path.js";
import { loadSettings } from "../settings.js";
import { failureNote } from "./remote.js";
import { parseSearchConfiguration, type SearchConfiguration } from "./settings.js";

export function searchConfiguration(
  db: SwarmDb,
  supplied?: SearchConfiguration,
): {
  settings: SearchConfiguration;
  notes: string[];
} {
  try {
    const settings = supplied ?? loadSettings(projectOf(db.dataDir)).settings;
    return { settings: parseSearchConfiguration({ ...settings }), notes: [] };
  } catch (error) {
    return { settings: {}, notes: [failureNote("settings", error)] };
  }
}
