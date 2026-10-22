import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { USER_NAME } from "../constants.js";
import type { RunEndStatus } from "../broker/swarms.js";
import { readRunProgress, type RunProgress } from "../broker/run-progress.js";
import type { RunOutcome } from "../broker/swarm-run.js";
import type { SwarmDb } from "../store/db.js";
import { listInboxAfter, unreadCounts } from "../store/message-queries.js";
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
  const lines = [
    `Swarm "${swarm.name}" (#${swarm.id}) ${END_TEXT[end]}. Run ${run}. ${plural(swarm.agentAmount, "agent")}, ` +
      `${formatElapsed(progress.elapsedMs)}, ${formatCost(progress.cost)}, ${formatTokens(progress.tokens)} tokens.`,
  ];
  const acceptance = outcome.acceptance;
  lines.push("", `Goal: ${acceptance.originalTask}`, "Acceptance criteria:");
  for (const [index, criterion] of acceptance.acceptanceCriteria.entries()) {
    lines.push(`${index + 1}. ${criterion}`);
  }
  lines.push("");
  if (end === "finished") {
    lines.push(`Task verdict: ${acceptance.verdict} (acceptance revision ${acceptance.revision}).`);
    lines.push(
      acceptance.verdict === "accepted"
        ? "Accepted by agent votes, not independent verification of the work."
        : "Task completion is not accepted; unresolved work remains.",
    );
  } else {
    lines.push(
      `Task verdict: not finalized (run ${end}; acceptance revision ${acceptance.revision}).`,
      `Recorded vote verdict: ${acceptance.verdict}. No completion verdict was finalized.`,
    );
  }
  const { counts, threshold, totalAgents, votes } = acceptance;
  lines.push(
    `Tally: ${counts.accepted} accepted, ${counts.incomplete} incomplete, ${counts.blocked} blocked; ` +
      `${votes.length}/${totalAgents} agents voted. Threshold: ${threshold}/${totalAgents} matching accepted or blocked votes.`,
    "",
    "Agent votes and reasons:",
  );
  if (votes.length === 0) lines.push("No votes recorded.");
  for (const vote of votes) {
    lines.push(`- ${vote.agent} (run ${vote.run}): ${vote.verdict}. Reason: ${vote.reason}`);
  }
  if (crashed.length > 0) lines.push(`Crashed and not revived: ${crashed.join(", ")}.`);
  lines.push("", url === null ? "Board: not running." : `Board: ${url}`);
  lines.push(userMessagesLine(db, swarm.id), "", ...nextSteps(swarm.id, end));
  return lines.join("\n");
}

function userMessagesLine(db: SwarmDb, swarmId: number): string {
  const total = listInboxAfter(db, swarmId, USER_NAME, 0).length;
  if (total === 0) return `Messages to ${USER_NAME}: none.`;
  const unread = unreadCounts(db, swarmId, [USER_NAME])[USER_NAME] ?? 0;
  return `Messages to ${USER_NAME}: ${total}${unread > 0 ? `, ${unread} unread` : ""} (see board).`;
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
