import type { CriterionBlocker, CriterionRecord, CriterionVote, TaskRecord } from "../api-work-types.js";
import { USER_NAME } from "../constants.js";
import { criterionTasks, criterionVotes, getBlocker, getCriterion, listCriteria } from "../store/criteria.js";
import type { SwarmDb } from "../store/db.js";
import { criterionStates, type CriterionState } from "../store/work-state.js";
import { workRoster } from "../store/work-roster.js";
import { BrokerError } from "./errors.js";

export interface CriterionAssessment extends CriterionState {
  revision: number;
  archivedAt: number | null;
  blocker: CriterionBlocker | null;
  reasons: string[];
  requiredOwners: string[];
  offlineTasks: number[];
  votes: (CriterionVote & { stale: boolean })[];
  missingSatisfied: string[];
  missingBlocked: string[];
}
export function linksSignature(tasks: readonly TaskRecord[]): string {
  return [...tasks]
    .sort((a, b) => a.id - b.id)
    .map((task) => `${task.id}:${task.revision}`)
    .join(",");
}
export function voteIsCurrent(
  vote: CriterionVote,
  revision: number,
  signature: string,
  blockerRevision: number | null,
): boolean {
  return (
    vote.criterionRevision === revision &&
    vote.linksSignature === signature &&
    (vote.verdict !== "blocked" || vote.blockerRevision === blockerRevision)
  );
}
export function assessCriterion(db: SwarmDb, swarmId: number, id: number): CriterionAssessment {
  const criterion = getCriterion(db, swarmId, id);
  const state = criterionStates(db, swarmId, true).find((item) => item.id === id);
  if (!criterion || !state) throw new BrokerError("not_found", `Criterion #${id} not found.`);
  return assess(db, criterion, state, activeNames(db, swarmId));
}
export function assessCriteria(db: SwarmDb, swarmId: number, includeArchived = false): CriterionAssessment[] {
  const states = new Map(criterionStates(db, swarmId, includeArchived).map((state) => [state.id, state]));
  const active = activeNames(db, swarmId);
  return listCriteria(db, swarmId, includeArchived).map((criterion) => {
    const state = states.get(criterion.id);
    if (!state) throw new Error(`Missing criterion state #${criterion.id}.`);
    return assess(db, criterion, state, active);
  });
}
function activeNames(db: SwarmDb, swarmId: number): Set<string> {
  return new Set([
    USER_NAME,
    ...workRoster(db, swarmId)
      .filter((agent) => agent.active)
      .map((agent) => agent.name),
  ]);
}
function assess(
  db: SwarmDb,
  criterion: CriterionRecord,
  state: CriterionState,
  active: ReadonlySet<string>,
): CriterionAssessment {
  const id = criterion.id;
  const tasks = criterionTasks(db, id);
  const owners = new Set(tasks.flatMap((task) => (task.owner === null ? [] : [task.owner])));
  const requiredOwners = [...owners].filter((owner) => active.has(owner)).sort();
  const offlineTasks = tasks.filter((task) => task.owner !== null && !active.has(task.owner)).map((task) => task.id);
  const blocker = getBlocker(db, id);
  const votes = criterionVotes(db, id).map((vote) => ({
    ...vote,
    stale:
      !voteIsCurrent(vote, criterion.revision, state.linksSignature, blocker?.revision ?? null) ||
      (vote.verdict === "blocked" && blocker !== null && blocker.rejectedRevision === blocker.revision),
  }));
  const missing = (verdict: "satisfied" | "blocked") => {
    const current = votes.filter((vote) => !vote.stale && vote.verdict === verdict);
    return [
      ...requiredOwners.filter((owner) => !current.some((vote) => vote.voter === owner)),
      ...(!current.some((vote) => !owners.has(vote.voter)) ? ["independent"] : []),
    ];
  };
  const missingSatisfied = missing("satisfied");
  const missingBlocked = missing("blocked");
  const reasons: string[] = [];
  if (state.status === "unlinked") reasons.push("No linked tasks. Create or link a task.");
  for (const taskId of offlineTasks) reasons.push(`owner offline — hand off task #${taskId}`);
  if (state.status === "blocked") reasons.push("All required voters agree on the current blocker.");
  if (state.status === "incomplete") {
    for (const task of tasks.filter((item) => item.status !== "accepted"))
      reasons.push(`task #${task.id} ${task.status}`);
    const needed =
      blocker && votes.some((vote) => !vote.stale && vote.verdict === "blocked") ? missingBlocked : missingSatisfied;
    if (needed.length) reasons.push(`waiting for votes: ${needed.join(", ")}`);
    for (const vote of votes.filter((item) => !item.stale && item.verdict !== "satisfied"))
      reasons.push(`${vote.voter}: ${vote.verdict}: ${vote.reason}`);
  }
  if (state.status === "satisfied") reasons.push("All linked tasks accepted and required votes current.");
  return {
    ...state,
    revision: criterion.revision,
    archivedAt: criterion.archivedAt,
    blocker,
    reasons,
    requiredOwners,
    offlineTasks,
    votes,
    missingSatisfied,
    missingBlocked,
  };
}
