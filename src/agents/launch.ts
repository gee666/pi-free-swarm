// How an agent's `pi --mode rpc` child is spawned and killed (docs/pi-findings.md §1, §4, decisions 1–6).
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { PI_ARGS_PREFIX_ENV, PI_COMMAND_ENV } from "../constants.js";
import type { AgentLaunchContext } from "../runtime-types.js";
import { registerAgentProcess } from "./process-registry.js";

export interface AgentLaunchSpec {
  name: string;
  cwd: string;
  /** Absolute; may not exist yet (pi creates it on the first persisted message). */
  sessionFile: string;
  /** Absolute and written before launch: pi uses a missing path as literal prompt text. */
  systemPromptFile: string;
  context: AgentLaunchContext;
  env: Record<string, string>;
}

const EXTENSION_FLAGS = new Set(["-e", "--extension"]);
/** Package sources pi resolves itself; everything else is a path relative to the main process's cwd. */
const PACKAGE_SOURCE = /^(?:npm|git):/;

function parseArgsPrefix(raw: string | undefined): string[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    throw new Error(`${PI_ARGS_PREFIX_ENV} must be a JSON array of strings.`);
  }
  return parsed;
}

/** Re-runs the node binary and pi entrypoint of this process, so no shell or PATH lookup is needed. */
export function getPiCommand(env: NodeJS.ProcessEnv = process.env): { command: string; argsPrefix: string[] } {
  const override = env[PI_COMMAND_ENV];
  if (override) return { command: override, argsPrefix: parseArgsPrefix(env[PI_ARGS_PREFIX_ENV]) };
  const entrypoint = process.argv[1];
  if (entrypoint && !entrypoint.startsWith("-")) {
    const resolved = path.resolve(entrypoint);
    if (fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
      return { command: process.execPath, argsPrefix: [resolved] };
    }
  }
  return { command: "pi", argsPrefix: [] };
}

function extensionValue(source: string, cwd: string): string {
  return PACKAGE_SOURCE.test(source) ? source : path.resolve(cwd, source);
}

export function forwardedExtensionArgs(argv: readonly string[] = process.argv, cwd: string = process.cwd()): string[] {
  const values: string[] = [];
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const equals = arg.indexOf("=");
    if (equals > 0 && EXTENSION_FLAGS.has(arg.slice(0, equals))) {
      values.push(extensionValue(arg.slice(equals + 1), cwd));
    } else if (EXTENSION_FLAGS.has(arg) && index + 1 < args.length) {
      values.push(extensionValue(args[++index], cwd));
    }
  }
  return values;
}

/** Shims and elevated shells can start pi with a PATH missing node or its bin dir; tools need both. */
export function buildChildProcessEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = { ...process.env, ...extra };
  const entries: string[] = [];
  const add = (value: string | undefined) => {
    for (const entry of value?.split(path.delimiter) ?? []) {
      const clean = entry.trim();
      if (clean && !entries.includes(clean)) entries.push(clean);
    }
  };
  add(inherited.PATH);
  add(path.dirname(process.execPath));
  add(process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : undefined);
  add(inherited.PNPM_HOME);
  if (inherited.npm_config_prefix) {
    add(inherited.npm_config_prefix);
    add(path.join(inherited.npm_config_prefix, "bin"));
  }
  return { ...inherited, PATH: entries.join(path.delimiter) };
}

export function buildAgentArgs(spec: AgentLaunchSpec): string[] {
  const { context } = spec;
  const args = ["--mode", "rpc", "--session", spec.sessionFile, "--append-system-prompt", spec.systemPromptFile];
  for (const extension of context.extensionArgs) args.push("-e", extension);
  args.push(context.projectTrusted ? "--approve" : "--no-approve");
  if (context.model) {
    args.push("--model", `${context.model.provider}/${context.model.modelId}`);
    if (context.model.thinkingLevel) args.push("--thinking", context.model.thinkingLevel);
  }
  return args;
}

/** Detached: Ctrl+C cannot reach it. TERM lets pi clean up tools in separately detached groups. */
export function spawnAgentProcess(spec: AgentLaunchSpec): ChildProcess {
  const { command, argsPrefix } = getPiCommand();
  const proc = spawn(command, [...argsPrefix, ...buildAgentArgs(spec)], {
    cwd: spec.cwd,
    shell: false,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: buildChildProcessEnv(spec.env),
  });
  registerAgentProcess(proc);
  return proc;
}

/** Never SIGINT: an RPC child has no handler for it and dies without session_shutdown. */
export function stopProcessTree(proc: ChildProcess, force: boolean): void {
  const signal = force ? "SIGKILL" : "SIGTERM";
  try {
    if (proc.pid !== undefined) process.kill(-proc.pid, signal);
    else proc.kill(signal);
  } catch {
    // The group is already gone; the leader may still be reachable on its own.
    proc.kill(signal);
  }
}

export function hasSessionFile(sessionFile: string): boolean {
  return (fs.statSync(sessionFile, { throwIfNoEntry: false })?.size ?? 0) > 0;
}
