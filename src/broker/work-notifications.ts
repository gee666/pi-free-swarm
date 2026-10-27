import { SYSTEM_NAME } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { criterionTasks } from "../store/criteria.js";
import { workRoster, type WorkAgent } from "../store/work-roster.js";
import { assessCriterion } from "./criterion-status.js";
import { createThread, insertMessage } from "./message-insert.js";

export function chooseWorkRecipient(agents: readonly WorkAgent[], excluded: readonly string[]): string | null {
  const candidates = agents.filter((agent) => agent.active && !excluded.includes(agent.name));
  candidates.sort(
    (a, b) =>
      Number(b.idle) - Number(a.idle) || a.openTasks - b.openTasks || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return candidates[0]?.name ?? null;
}

/** One recipient row per message makes delivery and acknowledgement independent. */
export function notifyWork(db: SwarmDb, swarmId: number, recipient: string | null, body: string, now: number): void {
  if (recipient === null) return;
  const threadId = createThread(db, swarmId, [SYSTEM_NAME, recipient], now);
  insertMessage(db, {
    swarmId,
    threadId,
    sender: SYSTEM_NAME,
    text: body,
    recipients: [{ name: recipient, status: "pending" }],
    now,
  });
}
export function notifyVoteNeeded(db: SwarmDb, swarmId: number, criterionId: number, now: number): void {
  const assessment = assessCriterion(db, swarmId, criterionId);
  const owners = criterionTasks(db, criterionId).flatMap((task) => (task.owner === null ? [] : [task.owner]));
  for (const owner of assessment.requiredOwners.filter((name) => assessment.missingSatisfied.includes(name))) {
    notifyWork(
      db,
      swarmId,
      owner,
      `Criterion #${criterionId} needs your vote. Call swarm_criteria_get then swarm_criteria_vote.`,
      now,
    );
  }
  if (assessment.missingSatisfied.includes("independent")) {
    notifyWork(
      db,
      swarmId,
      chooseWorkRecipient(workRoster(db, swarmId), owners),
      `Criterion #${criterionId} needs an independent vote. Call swarm_criteria_get then swarm_criteria_vote.`,
      now,
    );
  }
}
export function notifyBlockerDecision(
  db: SwarmDb,
  swarmId: number,
  criterionId: number,
  decision: "approve" | "reject",
  now: number,
): void {
  const assessment = assessCriterion(db, swarmId, criterionId);
  const owners = criterionTasks(db, criterionId).flatMap((task) => (task.owner === null ? [] : [task.owner]));
  const independent = assessment.votes
    .filter((vote) => !vote.stale && vote.verdict === "blocked" && !owners.includes(vote.voter))
    .map((vote) => vote.voter);
  for (const recipient of new Set([...assessment.requiredOwners, ...independent])) {
    notifyWork(
      db,
      swarmId,
      recipient,
      `User ${decision === "approve" ? "approved" : "rejected"} blocker #${criterionId}.${decision === "reject" ? " Keep working." : ""} Call swarm_criteria_get.`,
      now,
    );
  }
}
