import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { SETTINGS_FILE, SWARM_DIR } from "./constants.js";
import { SettingsError } from "./settings-error.js";

export function globalSettingsFile(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PI_CODING_AGENT_DIR;
  const agentDir = configured
    ? configured === "~"
      ? homedir()
      : configured.startsWith("~/") || configured.startsWith("~\\")
        ? path.join(homedir(), configured.slice(2))
        : configured
    : path.join(homedir(), ".pi", "agent");
  return path.resolve(agentDir, "swarm", SETTINGS_FILE);
}

export function projectSettingsFile(cwd: string): string {
  return path.join(cwd, SWARM_DIR, SETTINGS_FILE);
}

export function readSettingsObject(file: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw new SettingsError(`cannot be read (${errorCode(error) ?? "unknown error"})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // V8 includes offending source values in errors. Never expose credentials from env.
    const reason = (error instanceof Error ? error.message : "")
      .replace(/,?\s*(?:\.\.\.)?"[\s\S]*$/, "")
      .replace(/\s*'[^']*'/g, "")
      .trim();
    throw new SettingsError(`invalid JSON (${reason || "syntax error"})`);
  }
  if (!isRecord(parsed)) throw new SettingsError("must be a JSON object");
  return parsed;
}

export function layeredSettings(cwd: string, globalFile: string | null): Record<string, unknown> | null {
  const global = globalFile === null ? null : readSettingsObject(globalFile);
  const project = readSettingsObject(projectSettingsFile(cwd));
  if (global === null && project === null) return null;
  const combined = { ...global, ...project };
  if (isRecord(global?.env) && isRecord(project?.env)) combined.env = { ...global.env, ...project.env };
  return combined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
