import { SYSTEM_NAME } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { criterionTasks } from "../store/criteria.js";
import { workRoster, type WorkAgent } from "../store/work-roster.js";
import { recordVoteRequest, requestedVoters, type VoteRequestPhase } from "../store/vote-requests.js";
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
export function notifyVoteNeeded(
  db: SwarmDb,
  swarmId: number,
  criterionId: number,
  now: number,
  alreadyNotified: Set<string> = new Set(),
  phase: VoteRequestPhase = "coverage",
): void {
  const assessment = assessCriterion(db, swarmId, criterionId);
  if (assessment.archivedAt !== null || assessment.taskCount === 0 || assessment.unownedCount > 0) return;
  const owners = criterionTasks(db, criterionId).flatMap((task) => (task.owner === null ? [] : [task.owner]));
  const current = assessment.votes.filter((vote) => !vote.stale);
  const requested = requestedVoters(db, assessment, phase);
  const send = (recipient: string, independent: boolean) => {
    if (requested.includes(recipient)) return;
    recordVoteRequest(db, assessment, phase, recipient);
    if (alreadyNotified.has(recipient)) return;
    alreadyNotified.add(recipient);
    const readiness = phase === "accepted" ? " All linked tasks are accepted." : " Coverage is staffed.";
    notifyWork(
      db,
      swarmId,
      recipient,
      `Criterion #${criterionId} needs ${independent ? "an independent vote" : "your vote"}.${readiness} Do the linked tasks, when done, fully satisfy this criterion? Call swarm_criteria_get then swarm_criteria_vote (covered/gap/blocked).`,
      now,
    );
  };
  for (const owner of assessment.requiredOwners.filter((name) => !current.some((vote) => vote.voter === name)))
    send(owner, false);
  if (!current.some((vote) => !owners.includes(vote.voter)) && !requested.some((name) => !owners.includes(name))) {
    const recipient = chooseWorkRecipient(workRoster(db, swarmId), owners);
    if (recipient !== null) send(recipient, true);
  }
}
