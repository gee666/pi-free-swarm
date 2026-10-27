import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SwarmSettings } from "./settings.js";
import { SettingsError } from "./settings-error.js";
import { globalSettingsFile, projectSettingsFile, readSettingsObject } from "./settings-files.js";

/** Deliberate whitelist: session activation and active env credentials never cross scopes. */
export function settingsForPersistence(settings: SwarmSettings) {
  return {
    port: settings.port ?? undefined,
    minAgents: settings.minAgents,
    maxAgents: settings.maxAgents,
    defaultAgents: settings.defaultAgents,
    staggerSeconds: settings.staggerSeconds,
    idleReminderDelay: settings.idleReminderDelay,
    maxRpcFrameBytes: settings.maxRpcFrameBytes,
    models: settings.models,
    search: settings.search,
    helperModel: settings.helperModel,
    budgetMoneyUsd: settings.budgetMoneyUsd,
    budgetTimeSeconds: settings.budgetTimeSeconds,
    gracefulShutdownOnBudget: settings.gracefulShutdownOnBudget ?? false,
  };
}

export function settingsForDisplay(settings: SwarmSettings) {
  return {
    ...settingsForPersistence(settings),
    env: Object.keys(settings.env)
      .sort()
      .map((key) => `${key}=<redacted>`),
  };
}

export function saveSessionSettings(
  cwd: string,
  settings: SwarmSettings,
  target: "project" | "global",
  options: { globalFile?: string } = {},
): string {
  if (target !== "project" && target !== "global") throw new SettingsError("save target must be project or global");
  const file = target === "project" ? projectSettingsFile(cwd) : (options.globalFile ?? globalSettingsFile());
  // Preserve destination-owned env and unknown fields, never copy this session's env into them.
  const previous = readSettingsObject(file) ?? {};
  const content = JSON.stringify({ ...previous, ...settingsForPersistence(settings) }, null, 2) + "\n";
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, { mode: 0o600 });
  return file;
}
