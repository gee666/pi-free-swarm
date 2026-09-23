// `swarm` and `resume_swarm`, the main agent's two tools. Both block until the run ends and stream a
// status snapshot about once a second; Esc aborts the tool signal, which stops the swarm.
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { systemClock } from "../clock.js";
import { MAIN_TOOL, SETTINGS_FILE, SWARM_DIR } from "../constants.js";
import { checkText, checkTitle, MAIN_FEEDBACK_MAX, TITLE_MAX } from "../limits.js";
import { BrokerError } from "../broker/errors.js";
import { readRunProgress, type RunProgress } from "../broker/run-progress.js";
import { resumeSwarm, startSwarm, type RunEnvironment, type RunOptions, type RunOutcome } from "../broker/swarm-run.js";
import type { MainRuntime } from "../main-runtime.js";
import { describeAgentRange, loadSettings, resolveAgentAmount, type SwarmSettings } from "../settings.js";
import type { SwarmDb } from "../store/db.js";
import {
  PLAIN_THEME,
  progressLines,
  renderCallLine,
  renderResumeCall,
  renderSwarmCall,
  renderToolResult,
} from "./render.js";
import { buildRunResultText } from "./result.js";
import { buildRunEnvironment, gitignoreHint, type LaunchSource } from "./run-environment.js";

/** The runner entry points; tests replace them to exercise the tools without agents. */
export interface SwarmRunner {
  startSwarm: typeof startSwarm;
  resumeSwarm: typeof resumeSwarm;
}

const DEFAULT_RUNNER: SwarmRunner = { startSwarm, resumeSwarm };

export const SWARM_PARAMS = Type.Object({
  swarm_name: Type.String({ description: `Short kebab-case name, max ${TITLE_MAX} chars, e.g. "auth-refactor".` }),
  task_prompt: Type.String({
    description:
      "The whole task for the agents. Include the paths of the requirements/plan files you wrote; agents read them.",
  }),
  agent_amount: Type.Optional(Type.Integer({ description: "Number of agents; omit for the default." })),
});

export const RESUME_PARAMS = Type.Object({
  swarm_id: Type.Integer({ description: "Id from the swarm result, e.g. 3." }),
  message: Type.String({
    description: `Feedback for the agents, max ${MAIN_FEEDBACK_MAX} chars: what is wrong or missing and what to do.`,
  }),
});

type ToolResult = AgentToolResult<RunProgress>;
type OnUpdate = ((partial: ToolResult) => void) | undefined;

/** Read fresh on every call; warnings go to the user, a SettingsError fails the tool. */
function readSettings(runtime: MainRuntime): SwarmSettings {
  const { settings, warnings } = loadSettings(runtime.cwd);
  for (const warning of warnings) runtime.notify(warning, "warning");
  return settings;
}

export function swarmDescription(cwd: string): string {
  let range: string;
  try {
    range = describeAgentRange(loadSettings(cwd).settings);
  } catch (error) {
    range = `agent_amount: ${SWARM_DIR}/${SETTINGS_FILE} is invalid (${error instanceof Error ? error.message : String(error)})`;
  }
  return [
    "Launch a leaderless swarm of pi agents on ONE task in this project; they self-organise on a shared wall.",
    "Use it when the user asks for a swarm, after the requirements are written to files.",
    `Keep task_prompt concise and point to those files. ${range}.`,
    "Blocks until every agent is idle, then returns the wall digest; review the real work before summarising.",
  ].join(" ");
}

function toolResult(text: string, progress: RunProgress): ToolResult {
  return { content: [{ type: "text", text }], details: progress };
}

interface RunRequest {
  db: SwarmDb;
  settings: SwarmSettings;
  ctx: LaunchSource;
  signal: AbortSignal | undefined;
  onUpdate: OnUpdate;
  start(env: RunEnvironment, options: RunOptions): Promise<RunOutcome>;
}

/** The tool bodies. Separate from registration so tests need neither pi nor a full tool context. */
export function createMainToolHandlers(runtime: MainRuntime, runner: SwarmRunner = DEFAULT_RUNNER) {
  async function run(request: RunRequest): Promise<ToolResult> {
    const { db, onUpdate } = request;
    runtime.host.start();
    await runtime.host.ensure();
    const env = buildRunEnvironment(runtime, db, request.settings, request.ctx);
    const onProgress = (progress: RunProgress) =>
      onUpdate?.(toolResult(progressLines(progress, PLAIN_THEME).join("\n"), progress));
    const outcome = await request.start(env, { signal: request.signal, onProgress });
    const now = systemClock.now();
    const boardUrl = runtime.host.boardUrl();
    const final = { ...readRunProgress(db, outcome.swarm.id, now, boardUrl), status: outcome.end };
    return toolResult(buildRunResultText(db, outcome, boardUrl, now), final);
  }

  return {
    async swarm(
      params: Static<typeof SWARM_PARAMS>,
      signal: AbortSignal | undefined,
      onUpdate: OnUpdate,
      ctx: LaunchSource,
    ): Promise<ToolResult> {
      const name = checkTitle(params.swarm_name);
      if (!name.ok) throw new BrokerError("validation", `swarm_name: ${name.error}`, "swarm_name");
      const taskPrompt = checkText(params.task_prompt, Infinity);
      if (!taskPrompt.ok) throw new BrokerError("validation", `task_prompt: ${taskPrompt.error}`, "task_prompt");
      const settings = readSettings(runtime);
      const agentAmount = resolveAgentAmount(settings, params.agent_amount);
      // The first swarm of a project creates .pi/swarm/: the one moment to suggest ignoring it.
      const firstSwarm = runtime.getDb(false) === null;
      const db = runtime.getDb(true);
      if (db === null) throw new Error("Could not create the swarm database.");
      const input = { name: name.value, taskPrompt: taskPrompt.value, agentAmount };
      const result = await run({
        db,
        settings,
        ctx,
        signal,
        onUpdate,
        start: (env, options) => runner.startSwarm(env, input, options),
      });
      const hint = firstSwarm ? gitignoreHint(runtime.cwd) : null;
      if (hint !== null) result.content.push({ type: "text", text: hint });
      return result;
    },
    async resume(
      params: Static<typeof RESUME_PARAMS>,
      signal: AbortSignal | undefined,
      onUpdate: OnUpdate,
      ctx: LaunchSource,
    ): Promise<ToolResult> {
      const settings = readSettings(runtime);
      const db = runtime.getDb(false);
      if (db === null) throw new Error(`Swarm #${params.swarm_id} not found: this project has no swarms yet.`);
      const input = { swarmId: params.swarm_id, message: params.message };
      return run({
        db,
        settings,
        ctx,
        signal,
        onUpdate,
        start: (env, options) => runner.resumeSwarm(env, input, options),
      });
    },
  };
}

export function registerMainTools(pi: Pick<ExtensionAPI, "registerTool">, runtime: MainRuntime): void {
  const handlers = createMainToolHandlers(runtime);
  pi.registerTool({
    name: MAIN_TOOL.swarm,
    label: "Swarm",
    description: swarmDescription(runtime.cwd),
    promptSnippet: "Launch a self-organising swarm of agents on one task and wait for it to finish.",
    parameters: SWARM_PARAMS,
    execute: (_toolCallId, params, signal, onUpdate, ctx) => handlers.swarm(params, signal, onUpdate, ctx),
    renderCall: (args, theme, context) => renderCallLine(renderSwarmCall(args, theme), context.executionStarted),
    renderResult: (result, options, theme, context) =>
      renderToolResult(result, options, theme, {
        isError: context.isError,
        callLine: renderSwarmCall(context.args, theme),
      }),
  });
  pi.registerTool({
    name: MAIN_TOOL.resumeSwarm,
    label: "Resume swarm",
    description:
      "Resume a finished, stopped or interrupted swarm of this project with your feedback; every agent gets it " +
      "and they discuss it on the wall before working. Be concise and specific. Blocks and returns like swarm.",
    promptSnippet: "Resume a swarm with feedback on its work.",
    parameters: RESUME_PARAMS,
    execute: (_toolCallId, params, signal, onUpdate, ctx) => handlers.resume(params, signal, onUpdate, ctx),
    renderCall: (args, theme, context) => renderCallLine(renderResumeCall(args, theme), context.executionStarted),
    renderResult: (result, options, theme, context) =>
      renderToolResult(result, options, theme, {
        isError: context.isError,
        callLine: renderResumeCall(context.args, theme),
      }),
  });
}
