// Global defaults and project overrides are read fresh for each launch. Env values never enter errors.
import { globalSettingsFile, layeredSettings } from "./settings-files.js";
import { SettingsError } from "./settings-error.js";
export { SettingsError } from "./settings-error.js";
import {
  AGENT_NAME_ENV,
  AGENT_ROLE,
  DB_ENV,
  DEFAULT_AGENTS,
  DEFAULT_IDLE_REMINDER_DELAY,
  DEFAULT_IDLE_REMINDER_DIGEST_SIZE,
  DEFAULT_MAX_AGENTS,
  DEFAULT_MIN_AGENTS,
  DEFAULT_PORT,
  DEFAULT_STAGGER_SECONDS,
  PORT_ENV,
  PORT_FALLBACK_LAST,
  RESERVED_ENV_PREFIX,
  ROLE_ENV,
  RUNNER_PID_ENV,
  RUN_ENV,
  SETTINGS_FILE,
  SWARM_ID_ENV,
} from "./constants.js";

import { BODY_SAFETY_MAX, BODY_STATED_MIN, TEXT_MAX } from "./limits.js";
import { parseModelProfiles, type ModelProfile } from "./model-allocation.js";
import { DEFAULT_MAX_RPC_FRAME_BYTES } from "./agents/jsonl.js";

export interface SwarmSettings {
  budgetMoneyUsd?: number;
  budgetTimeSeconds?: number;
  gracefulShutdownOnBudget?: boolean;
  models?: readonly ModelProfile[];
  maxRpcFrameBytes?: number;
  /** From the file only; `null` = not set. */
  port: number | null;
  minAgents: number;
  maxAgents: number;
  /** Already clamped into `[minAgents, maxAgents]`. */
  defaultAgents: number;
  staggerSeconds: number;
  /** Milliseconds of idle time before a reminder. */
  idleReminderDelay: number;
  idleReminderDigestSize: number;
  bodyMaxChars: number;
  /** `PI_SWARM_*` keys already dropped. */
  env: Readonly<Record<string, string>>;
}

export interface AgentIdentity {
  dbPath: string;
  swarmId: number;
  run: number;
  agentName: string;
  runnerPid: number;
}

const KNOWN_KEYS = new Set([
  "port",
  "minAgents",
  "maxAgents",
  "defaultAgents",
  "staggerSeconds",
  "idleReminderDelay",
  "idleReminderDigestSize",
  "bodyMaxChars",
  "env",
  "models",
  "maxRpcFrameBytes",
  "budgetMoneyUsd",
  "budgetTimeSeconds",
  "gracefulShutdownOnBudget",
]);
const PORT_MIN = 1;
const PORT_MAX = 65_535;

export function loadSettings(
  cwd: string,
  options: { globalFile?: string | null } = {},
): { settings: SwarmSettings; warnings: string[] } {
  const parsed = layeredSettings(cwd, options.globalFile === undefined ? globalSettingsFile() : options.globalFile);
  const warnings: string[] = [];
  if (parsed === null) return { settings: buildSettings({}, {}), warnings };
  for (const key of Object.keys(parsed)) {
    if (!KNOWN_KEYS.has(key)) warnings.push(`${SETTINGS_FILE}: unknown key "${key}" ignored`);
  }

  const port = optionalInteger(parsed, "port", `an integer ${PORT_MIN}–${PORT_MAX}`, PORT_MIN, PORT_MAX);
  const minAgents = optionalInteger(parsed, "minAgents", "an integer >= 1", 1);
  const maxAgents = optionalInteger(parsed, "maxAgents", "an integer >= 1", 1);
  const defaultAgents = optionalInteger(parsed, "defaultAgents", "an integer");
  const staggerSeconds = optionalNumber(parsed, "staggerSeconds", "a number >= 0", 0);
  const bodyMaxChars = optionalInteger(
    parsed,
    "bodyMaxChars",
    `an integer ${BODY_STATED_MIN}–${BODY_SAFETY_MAX}`,
    BODY_STATED_MIN,
    BODY_SAFETY_MAX,
  );
  const idleReminderDelay = optionalInteger(parsed, "idleReminderDelay", "an integer >= 0", 0);
  const idleReminderDigestSize = optionalInteger(parsed, "idleReminderDigestSize", "an integer >= 1", 1);
  const maxRpcFrameBytes = optionalInteger(
    parsed,
    "maxRpcFrameBytes",
    "a positive safe integer",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  let models: readonly ModelProfile[] | undefined;
  try {
    models = parseModelProfiles(parsed.models);
  } catch (error) {
    throw new SettingsError(error instanceof Error ? error.message : "models is invalid");
  }
  const budgetMoneyUsd = positiveBudget(parsed, "budgetMoneyUsd");
  const budgetTimeSeconds = positiveBudget(parsed, "budgetTimeSeconds");
  if (parsed.gracefulShutdownOnBudget !== undefined && typeof parsed.gracefulShutdownOnBudget !== "boolean") {
    throw new SettingsError("gracefulShutdownOnBudget must be a boolean");
  }
  const gracefulShutdownOnBudget = parsed.gracefulShutdownOnBudget === true;
  const env = parseEnv(parsed.env, warnings);
  return {
    settings: buildSettings(
      {
        models,
        budgetMoneyUsd,
        budgetTimeSeconds,
        gracefulShutdownOnBudget,
        maxRpcFrameBytes,
        port,
        minAgents,
        maxAgents,
        defaultAgents,
        staggerSeconds,
        bodyMaxChars,
        idleReminderDelay,
        idleReminderDigestSize,
      },
      env,
    ),
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
    [RUN_ENV]: String(identity.run),
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

function positiveBudget(parsed: Record<string, unknown>, key: string): number | undefined {
  const value = parsed[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new SettingsError(`${key} must be a finite positive number; omit it for unlimited`);
  }
  return value;
}

interface ParsedNumbers {
  budgetMoneyUsd?: number;
  budgetTimeSeconds?: number;
  gracefulShutdownOnBudget?: boolean;
  models?: readonly ModelProfile[];
  maxRpcFrameBytes?: number;
  port?: number;
  minAgents?: number;
  maxAgents?: number;
  defaultAgents?: number;
  staggerSeconds?: number;
  idleReminderDelay?: number;
  idleReminderDigestSize?: number;
  bodyMaxChars?: number;
}

function buildSettings(values: ParsedNumbers, env: Record<string, string>): SwarmSettings {
  const minAgents = values.minAgents ?? DEFAULT_MIN_AGENTS;
  // The default max yields to an explicit min, so setting only minAgents never fails on a value the user did not set.
  const maxAgents = values.maxAgents ?? Math.max(DEFAULT_MAX_AGENTS, minAgents);
  if (maxAgents < minAgents) throw new SettingsError(`maxAgents (${maxAgents}) must be >= minAgents (${minAgents})`);
  const defaultAgents = Math.min(Math.max(values.defaultAgents ?? DEFAULT_AGENTS, minAgents), maxAgents);
  return {
    ...(values.models === undefined ? {} : { models: values.models }),
    budgetMoneyUsd: values.budgetMoneyUsd,
    budgetTimeSeconds: values.budgetTimeSeconds,
    gracefulShutdownOnBudget: values.gracefulShutdownOnBudget ?? false,
    maxRpcFrameBytes: values.maxRpcFrameBytes ?? DEFAULT_MAX_RPC_FRAME_BYTES,
    port: values.port ?? null,
    minAgents,
    maxAgents,
    defaultAgents,
    staggerSeconds: values.staggerSeconds ?? DEFAULT_STAGGER_SECONDS,
    idleReminderDelay: values.idleReminderDelay ?? DEFAULT_IDLE_REMINDER_DELAY,
    idleReminderDigestSize: values.idleReminderDigestSize ?? DEFAULT_IDLE_REMINDER_DIGEST_SIZE,
    bodyMaxChars: values.bodyMaxChars ?? TEXT_MAX,
    env,
  };
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

function optionalNumber(
  source: Record<string, unknown>,
  key: string,
  expected: string,
  min: number,
): number | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value === "number" && value >= min) return value;
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
