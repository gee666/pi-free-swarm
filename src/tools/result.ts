import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { RunEndStatus } from "../broker/swarms.js";
import { readRunProgress, type RunProgress } from "../broker/run-progress.js";
import type { RunOutcome } from "../broker/swarm-run.js";
import type { SwarmDb } from "../store/db.js";
import { evaluateCompletion } from "../broker/completion.js";
import { readProject } from "../broker/project.js";
import { listParticipants } from "../store/swarm-queries.js";
import { formatCost, formatElapsed, formatTokens, plural, swarmBoardUrl } from "./run-format.js";
import { agentToolResult } from "./agent-tool-result.js";

export type RunToolResult = AgentToolResult<RunProgress & { fullOutputPath?: string }>;

/** Bound the aggregate, including hints, without replacing the renderer's progress snapshot. */
export async function boundRunResult(result: RunToolResult): Promise<RunToolResult> {
  const text = result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  const bounded = await agentToolResult(text);
  if (bounded.details === undefined) return result;
  return { ...result, content: bounded.content, details: { ...result.details, ...bounded.details } };
}

const END_TEXT: Record<RunEndStatus, string> = {
  finished: "finished execution",
  stopped: "was stopped (tool aborted, all agents killed)",
  interrupted: "was interrupted (this pi process lost the swarm's run lock)",
};

export function buildRunResultText(db: SwarmDb, outcome: RunOutcome, boardUrl: string | null, now: number): string {
  const { swarm, run, end } = outcome;
  const progress = readRunProgress(db, swarm.id, now, boardUrl);
  const crashed = listParticipants(db, swarm.id).flatMap((p) =>
    p.kind === "agent" && p.status === "crashed" ? [p.name] : [],
  );
  const url = swarmBoardUrl(boardUrl, swarm.id);
  const endText = outcome.stopReason === "budget-exhausted" ? "stopped on budget exhaustion" : END_TEXT[end];
  const lines = [
    `Swarm "${swarm.name}" (#${swarm.id}) ${endText}. Run ${run}. ${plural(swarm.agentAmount, "agent")}, ` +
      `${formatElapsed(progress.elapsedMs)}, ${formatCost(progress.cost)}, ${formatTokens(progress.tokens)} tokens.`,
  ];
  const budget = outcome.budget;
  if (
    budget &&
    (outcome.stopReason === "budget-exhausted" ||
      budget.moneyUsd !== null ||
      budget.timeSeconds !== null ||
      budget.hasAccountingGaps ||
      budget.hasInterruptedRuns)
  ) {
    const reason =
      outcome.stopReason === "budget-exhausted"
        ? "Stop reason: budget-exhausted."
        : "Budget stop reason: none recorded.";
    lines.push(
      `${reason} Cumulative reported ${formatCost(budget.costUsd)} / ${budget.moneyUsd === null ? "unlimited" : formatCost(budget.moneyUsd)}; active ${formatElapsed(budget.activeTimeMs)} / ${budget.timeSeconds === null ? "unlimited" : formatElapsed(budget.timeSeconds * 1000)}.`,
      `Overshoot: $${budget.moneyOvershootUsd.toFixed(6)}, ${budget.timeOvershootSeconds.toFixed(3)} seconds.`,
      budget.accounting,
    );
    if (outcome.stopReason === "budget-exhausted")
      lines.push(
        "Resume only after user agreement: raise the swarm's ceiling in Config or raise budgetMoneyUsd/budgetTimeSeconds in .pi/swarm/settings.json, then call resume_swarm. Consumption is not reset. Inspect interrupted actions before repeating them.",
      );
  }
  lines.push(...completionLines(db, swarm.id, boardUrl));
  if (crashed.length > 0) lines.push(`Crashed and not revived: ${crashed.join(", ")}.`);
  lines.push("", url === null ? "Board: not running." : `Board: ${url}`);
  lines.push("", ...nextSteps(swarm.id, end));
  return lines.join("\n");
}

export function completionLines(db: SwarmDb, swarmId: number, boardUrl: string | null): string[] {
  const project = readProject(db, swarmId);
  const completion = evaluateCompletion(db, swarmId);
  const url = swarmBoardUrl(boardUrl, swarmId);
  return [
    `Brief: ${project.briefPath ?? "not recorded"}`,
    `Intent: ${project.intentSummary ?? "not recorded"} · ${project.intentPath ?? "no file"}`,
    `Outcome: ${project.outcome ?? completion.outcome ?? "unfinished"}`,
    ...completion.gates.map((gate) => `${gate.ok ? "OK" : "UNMET"} ${gate.key} (${gate.count}): ${gate.detail}`),
    url === null ? "Board: not running." : `Board: ${url}`,
  ];
}

function nextSteps(swarmId: number, end: RunEndStatus): string[] {
  const resume = `resume_swarm(${swarmId}, "<what is wrong and what to do>")`;
  if (end === "finished") {
    return [
      "Next: review the actual work (git status/diff, files mentioned on the wall, run tests),",
      "then summarise to the user. If the work is incomplete or wrong, call",
      `${resume}.`,
    ];
  }
  if (end === "stopped") {
    return [
      "Next: the work is unfinished. Tell the user what state it is in (git status/diff, wall);",
      `continue only if they want it, with ${resume}.`,
    ];
  }
  return [
    "Next: the work is probably unfinished. Review it (git status/diff, wall) and tell the user;",
    `${resume} continues the swarm.`,
  ];
}
