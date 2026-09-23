// `.pi/swarm/settings.json`: optional, hand-written, read fresh on every call so edits apply to the next
// launch without restarting pi. `env` values may be secrets: they never appear in errors or warnings.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AGENT_NAME_ENV,
  AGENT_ROLE,
  DB_ENV,
  DEFAULT_AGENTS,
  DEFAULT_MAX_AGENTS,
  DEFAULT_MIN_AGENTS,
  DEFAULT_PORT,
  DEFAULT_STAGGER_SECONDS,
  PORT_ENV,
  PORT_FALLBACK_LAST,
  RESERVED_ENV_PREFIX,
  ROLE_ENV,
  RUNNER_PID_ENV,
  SETTINGS_FILE,
  SWARM_DIR,
  SWARM_ID_ENV,
} from "./constants.js";

export interface SwarmSettings {
  /** From the file only; `null` = not set. */
  port: number | null;
  minAgents: number;
  maxAgents: number;
  /** Already clamped into `[minAgents, maxAgents]`. */
  defaultAgents: number;
  staggerSeconds: number;
  /** `PI_SWARM_*` keys already dropped. */
  env: Readonly<Record<string, string>>;
}

export interface AgentIdentity {
  dbPath: string;
  swarmId: number;
  agentName: string;
  runnerPid: number;
}

export class SettingsError extends Error {
  constructor(reason: string) {
    super(`${SETTINGS_FILE}: ${reason}`);
    this.name = "SettingsError";
  }
}

const KNOWN_KEYS = new Set(["port", "minAgents", "maxAgents", "defaultAgents", "staggerSeconds", "env"]);
const PORT_MIN = 1;
const PORT_MAX = 65_535;

export function loadSettings(cwd: string): { settings: SwarmSettings; warnings: string[] } {
  const raw = readSettingsFile(path.join(cwd, SWARM_DIR, SETTINGS_FILE));
  const warnings: string[] = [];
  if (raw === null) return { settings: buildSettings({}, {}), warnings };

  const parsed = parseJson(raw);
  if (!isRecord(parsed)) throw new SettingsError("must be a JSON object");
  for (const key of Object.keys(parsed)) {
    if (!KNOWN_KEYS.has(key)) warnings.push(`${SETTINGS_FILE}: unknown key "${key}" ignored`);
  }

  const port = optionalInteger(parsed, "port", `an integer ${PORT_MIN}–${PORT_MAX}`, PORT_MIN, PORT_MAX);
  const minAgents = optionalInteger(parsed, "minAgents", "an integer >= 1", 1);
  const maxAgents = optionalInteger(parsed, "maxAgents", "an integer >= 1", 1);
  const defaultAgents = optionalInteger(parsed, "defaultAgents", "an integer");
  const staggerSeconds = parsed.staggerSeconds;
  if (staggerSeconds !== undefined && !(typeof staggerSeconds === "number" && staggerSeconds >= 0)) {
    throw new SettingsError(`staggerSeconds must be a number >= 0 (got ${describe(staggerSeconds)})`);
  }
  const env = parseEnv(parsed.env, warnings);
  return {
    settings: buildSettings({ port, minAgents, maxAgents, defaultAgents, staggerSeconds }, env),
    warnings,
  };
}

/** `undefined` → the default. Never clamps: the caller must be able to tell the user the range. */
export function resolveAgentAmount(settings: SwarmSettings, requested: number | undefined): number {
  if (requested === undefined) return settings.defaultAgents;
  if (!Number.isInteger(requested) || requested < settings.minAgents || requested > settings.maxAgents) {
    throw new Error(`agent_amount must be between ${settings.minAgents} and ${settings.maxAgents} (got ${requested}).`);
  }
  return requested;
}

export function describeAgentRange(settings: SwarmSettings): string {
  return `agent_amount: ${settings.minAgents}–${settings.maxAgents}, default ${settings.defaultAgents}`;
}

/** `settings.env` plus the reserved variables, which always win. The inherited env is added at spawn. */
export function buildAgentEnv(settings: SwarmSettings, identity: AgentIdentity): Record<string, string> {
  return {
    ...settings.env,
    [ROLE_ENV]: AGENT_ROLE,
    [DB_ENV]: identity.dbPath,
    [SWARM_ID_ENV]: String(identity.swarmId),
    [AGENT_NAME_ENV]: identity.agentName,
    [RUNNER_PID_ENV]: String(identity.runnerPid),
  };
}

/** An explicit port (settings, then `PI_SWARM_PORT`) has no fallback; otherwise 3010…3030. */
export function resolvePort(
  settings: SwarmSettings,
  env: NodeJS.ProcessEnv = process.env,
): { candidates: number[]; explicit: boolean } {
  if (settings.port !== null) return { candidates: [settings.port], explicit: true };
  const fromEnv = env[PORT_ENV];
  if (fromEnv !== undefined && fromEnv !== "") {
    const port = Number(fromEnv);
    if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
      throw new Error(`${PORT_ENV} must be an integer ${PORT_MIN}–${PORT_MAX} (got ${JSON.stringify(fromEnv)}).`);
    }
    return { candidates: [port], explicit: true };
  }
  const candidates: number[] = [];
  for (let port = DEFAULT_PORT; port <= PORT_FALLBACK_LAST; port++) candidates.push(port);
  return { candidates, explicit: false };
}

interface ParsedNumbers {
  port?: number;
  minAgents?: number;
  maxAgents?: number;
  defaultAgents?: number;
  staggerSeconds?: number;
}

function buildSettings(values: ParsedNumbers, env: Record<string, string>): SwarmSettings {
  const minAgents = values.minAgents ?? DEFAULT_MIN_AGENTS;
  // The default max yields to an explicit min, so setting only minAgents never fails on a value the user did not set.
  const maxAgents = values.maxAgents ?? Math.max(DEFAULT_MAX_AGENTS, minAgents);
  if (maxAgents < minAgents) throw new SettingsError(`maxAgents (${maxAgents}) must be >= minAgents (${minAgents})`);
  const defaultAgents = Math.min(Math.max(values.defaultAgents ?? DEFAULT_AGENTS, minAgents), maxAgents);
  return {
    port: values.port ?? null,
    minAgents,
    maxAgents,
    defaultAgents,
    staggerSeconds: values.staggerSeconds ?? DEFAULT_STAGGER_SECONDS,
    env,
  };
}

function readSettingsFile(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw new SettingsError(`cannot be read (${errorCode(error) ?? "unknown error"})`);
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new SettingsError(`invalid JSON (${jsonErrorReason(error)})`);
  }
}

/** V8 quotes the offending source text in some parse errors; drop it so env values never leak. */
function jsonErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const reason = message
    .replace(/,?\s*(?:\.\.\.)?"[\s\S]*$/, "")
    .replace(/\s*'[^']*'/g, "")
    .trim();
  return reason === "" ? "syntax error" : reason;
}

function optionalInteger(
  source: Record<string, unknown>,
  key: string,
  expected: string,
  min = -Infinity,
  max = Infinity,
): number | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max) return value;
  throw new SettingsError(`${key} must be ${expected} (got ${describe(value)})`);
}

function parseEnv(value: unknown, warnings: string[]): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new SettingsError("env must be an object of string values");
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") throw new SettingsError(`env.${key} must be a string`);
    if (key.startsWith(RESERVED_ENV_PREFIX)) {
      warnings.push(`${SETTINGS_FILE}: env.${key} ignored (reserved prefix)`);
      continue;
    }
    env[key] = entry;
  }
  return env;
}

function describe(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
