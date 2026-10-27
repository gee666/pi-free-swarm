import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { systemClock } from "../clock.js";
import { MAIN_TOOL, SETTINGS_FILE, SWARM_DIR } from "../constants.js";
import { charCount, checkText, checkTitle, MAIN_FEEDBACK_MAX, TITLE_MAX } from "../limits.js";
import { BrokerError } from "../broker/errors.js";
import { requireAcceptanceCriteria } from "../broker/validate.js";
import { readRunProgress, type RunProgress } from "../broker/run-progress.js";
import { resumeSwarm, startSwarm, type RunEnvironment, type RunOptions, type RunOutcome } from "../broker/swarm-run.js";
import type { MainRuntime } from "../main-runtime.js";
import { applySessionOptions } from "../session-commands.js";
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
import { evaluateCompletion } from "../broker/completion.js";
import { boundRunResult, buildRunResultText, awaitingUserText, type RunToolResult } from "./result.js";
import { buildRunEnvironment, gitignoreHint, type LaunchSource } from "./run-environment.js";

/** The runner entry points; tests replace them to exercise the tools without agents. */
export interface SwarmRunner {
  startSwarm: typeof startSwarm;
  resumeSwarm: typeof resumeSwarm;
}

const DEFAULT_RUNNER: SwarmRunner = { startSwarm, resumeSwarm };

export const SWARM_PARAMS = Type.Object({
  swarm_name: Type.String({
    minLength: 1,
    pattern: "\\S",
    description: `Short kebab-case name, max ${TITLE_MAX} chars, e.g. "auth-refactor".`,
  }),
  task_prompt: Type.String({
    minLength: 1,
    pattern: "\\S",
    description:
      "The whole task for the agents. Include the paths of the requirements/plan files you wrote; agents read them.",
  }),
  acceptance_criteria: Type.Array(Type.String({ minLength: 1, pattern: "\\S" }), {
    minItems: 1,
    description:
      "Main's explicit, verifiable completion conditions. Define deliverables, locations/formats, required counts or coverage, quality standards, tests, evidence and review depth as applicable. Derive them from the task if absent; each entry must be nonempty. Do not launch with vague criteria or add requirements beyond the user's scope.",
  }),
  agent_amount: Type.Optional(
    Type.Integer({ minimum: 1, description: "Number of agents within the configured range; omit for the default." }),
  ),
});

export const RESUME_PARAMS = Type.Object({
  swarm_id: Type.Integer({ minimum: 1, description: "Id from the swarm result, e.g. 3." }),
  message: Type.String({
    minLength: 1,
    pattern: "\\S",
    description: `Feedback for the agents: what is wrong or missing and what to do. At most ${MAIN_FEEDBACK_MAX} chars.`,
  }),
});

type ToolResult = RunToolResult;
type OnUpdate = ((partial: ToolResult) => void) | undefined;

/** Read fresh on every call; warnings go to the user, a SettingsError fails the tool. */
function readSettings(runtime: MainRuntime): SwarmSettings {
  const { settings, warnings } = loadSettings(runtime.cwd);
  for (const warning of warnings) runtime.notify(warning, "warning");
  return applySessionOptions(settings, runtime.session);
}

export function swarmDescription(cwd: string, maxAgents?: number): string {
  let range: string;
  try {
    range = describeAgentRange(applySessionOptions(loadSettings(cwd).settings, { enabled: true, maxAgents }));
  } catch (error) {
    range = `agent_amount: ${SWARM_DIR}/${SETTINGS_FILE} is invalid (${error instanceof Error ? error.message : String(error)})`;
  }
  return [
    "Launch equal Pi agents on one project task, coordinated through a shared work graph.",
    "Use it when the user asks for a swarm, after the requirements are written to files.",
    `Keep task_prompt concise and point to those files. ${range}.`,
    "Acceptance criteria are the most important part of preparing a swarm run: they define what agents must deliver and what they judge as complete. Before launching, make them specific and verifiable. Specify the required deliverables and their locations/formats, minimum counts or coverage where relevant, quality requirements, tests and other validation, required evidence, and the scope and independence of verification. State constraints and exclusions explicitly. Avoid vague goals such as 'improve quality' or 'test thoroughly'; define observable completion conditions. If the user did not provide criteria, derive them from the task before launching, without inventing extra scope. Clear criteria strongly influence run quality, but votes do not replace Main's inspection of the result.",
    "Blocks until the run ends or only User decisions remain. Returns stop gates, outcome and board link. Ask the user to approve scope or decide blockers on the board; never decide on their behalf. Review the real work before summarising.",
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
  const assertEnabled = () => {
    if (runtime.session?.enabled === false)
      throw new BrokerError(
        "validation",
        "Swarm is disabled for this session. Use /swarm:enable before launching or resuming.",
      );
  };
  async function run(request: RunRequest): Promise<ToolResult> {
    const { db, onUpdate } = request;
    assertEnabled();
    runtime.host.start();
    await runtime.host.ensure();
    assertEnabled();
    const env = buildRunEnvironment(runtime, db, request.settings, request.ctx);
    let returned = false;
    let release: (progress: RunProgress) => void = () => undefined;
    const waiting = new Promise<RunProgress>((resolve) => {
      release = resolve;
    });
    const onProgress = (progress: RunProgress) => {
      if (returned) return;
      onUpdate?.(toolResult(progressLines(progress, PLAIN_THEME).join("\n"), progress));
      if (evaluateCompletion(db, progress.swarmId).awaitingUser) release(progress);
    };
    const running = request.start(env, { signal: request.signal, onProgress });
    const result = await Promise.race([
      running.then((outcome) => ({ kind: "ended" as const, outcome })),
      waiting.then((progress) => ({ kind: "waiting" as const, progress })),
    ]);
    returned = true;
    if (result.kind === "waiting")
      return toolResult(awaitingUserText(db, result.progress.swarmId, runtime.host.boardUrl()), result.progress);
    const outcome = result.outcome;
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
      assertEnabled();
      const name = checkTitle(params.swarm_name);
      if (!name.ok) throw new BrokerError("validation", `swarm_name: ${name.error}`, "swarm_name");
      if (charCount(name.value) > TITLE_MAX)
        throw new BrokerError("validation", `swarm_name must be at most ${TITLE_MAX} characters.`, "swarm_name");
      const taskPrompt = checkText(params.task_prompt, Infinity);
      if (!taskPrompt.ok) throw new BrokerError("validation", `task_prompt: ${taskPrompt.error}`, "task_prompt");
      const acceptanceCriteria = requireAcceptanceCriteria(params.acceptance_criteria);
      const settings = readSettings(runtime);
      const agentAmount = resolveAgentAmount(settings, params.agent_amount);
      // The first swarm of a project creates .pi/swarm/: the one moment to suggest ignoring it.
      const firstSwarm = runtime.getDb(false) === null;
      const db = runtime.getDb(true);
      if (db === null) throw new Error("Could not create the swarm database.");
      const input = { name: name.value, taskPrompt: taskPrompt.value, acceptanceCriteria, agentAmount };
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
      return boundRunResult(result);
    },
    async resume(
      params: Static<typeof RESUME_PARAMS>,
      signal: AbortSignal | undefined,
      onUpdate: OnUpdate,
      ctx: LaunchSource,
    ): Promise<ToolResult> {
      assertEnabled();
      const settings = readSettings(runtime);
      const db = runtime.getDb(false);
      if (db === null) throw new Error(`Swarm #${params.swarm_id} not found: this project has no swarms yet.`);
      const input = { swarmId: params.swarm_id, message: params.message };
      return boundRunResult(
        await run({
          db,
          settings,
          ctx,
          signal,
          onUpdate,
          start: (env, options) => runner.resumeSwarm(env, input, options),
        }),
      );
    },
  };
}

export function registerMainTools(pi: Pick<ExtensionAPI, "registerTool">, runtime: MainRuntime): void {
  const handlers = createMainToolHandlers(runtime);
  pi.registerTool({
    name: MAIN_TOOL.swarm,
    label: "Swarm",
    description: swarmDescription(runtime.cwd, runtime.session?.maxAgents),
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
      "Attach to an active swarm or resume an ended one with feedback to every active worker. Preserves the work graph and re-evaluates old votes. Blocks until the run ends or awaits User decisions.",
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
