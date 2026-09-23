// Everything a swarm run inherits from the main session, captured when `swarm`/`resume_swarm` executes:
// the live model and thinking level follow `/model`, so they are read now and reused for every revive.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { systemClock } from "../clock.js";
import { SETTINGS_FILE, SWARM_DIR } from "../constants.js";
import { forwardedExtensionArgs } from "../agents/launch.js";
import type { RunEnvironment } from "../broker/swarm-run.js";
import type { MainRuntime } from "../main-runtime.js";
import type { AgentLaunchContext } from "../runtime-types.js";
import type { SwarmSettings } from "../settings.js";
import type { SwarmDb } from "../store/db.js";

/** The parts of the tool context a run inherits. */
export type LaunchSource = Pick<ExtensionContext, "model" | "thinkingLevel" | "isProjectTrusted">;

export function captureLaunchContext(
  ctx: LaunchSource,
  extensionPath: string,
  argv?: readonly string[],
): AgentLaunchContext {
  return {
    extensionArgs: dedupeByRealpath([extensionPath, ...forwardedExtensionArgs(argv)]),
    projectTrusted: ctx.isProjectTrusted(),
    model:
      ctx.model === undefined
        ? null
        : { provider: ctx.model.provider, modelId: ctx.model.id, thinkingLevel: ctx.thinkingLevel ?? null },
  };
}

// pi dedupes by realpath too; doing it here keeps the child's argument list readable.
function dedupeByRealpath(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((entry) => {
    const key = canonical(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canonical(entry: string): string {
  try {
    return realpathSync(entry);
  } catch {
    // npm:/git: specs and missing paths are compared as written.
    return entry;
  }
}

export function buildRunEnvironment(
  runtime: MainRuntime,
  db: SwarmDb,
  settings: SwarmSettings,
  ctx: LaunchSource,
): RunEnvironment {
  return {
    cwd: runtime.cwd,
    db,
    runnerPid: process.pid,
    clock: systemClock,
    settings,
    launch: captureLaunchContext(ctx, runtime.extensionPath),
    boardUrl: () => runtime.host.boardUrl(),
    notifyUser: (text) => runtime.notify(text, "info"),
  };
}

const GITIGNORE_ENTRY = [`${SWARM_DIR}/*`, `!${SWARM_DIR}/${SETTINGS_FILE}`];

/** A one-time hint for the model to pass on; we never edit the user's .gitignore ourselves. */
export function gitignoreHint(cwd: string): string | null {
  const file = path.join(cwd, ".gitignore");
  if (existsSync(file) && readFileSync(file, "utf8").includes(SWARM_DIR)) return null;
  return [
    `Tell the user once: swarm runtime data lives in ${SWARM_DIR}/. To keep it out of git (${SETTINGS_FILE} stays`,
    "committable), suggest adding to .gitignore:",
    ...GITIGNORE_ENTRY,
  ].join("\n");
}
