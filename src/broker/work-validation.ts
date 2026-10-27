import type { SwarmDb } from "../store/db.js";
import type { CriterionRecord, TaskRecord } from "../api-work-types.js";
import { getCriterion } from "../store/criteria.js";
import { getTask } from "../store/tasks.js";
import { USER_NAME } from "../constants.js";
import { WORK_TEXT_ACCEPTED, WORK_TITLE_ACCEPTED, TEXT_MAX, TITLE_MAX, charCount } from "../limits.js";
import { BrokerError } from "./errors.js";
import { requireOpenRun } from "./run-ownership.js";
import { actAs, requireSwarm } from "./validate.js";
import { workRoster } from "../store/work-roster.js";

export interface WorkInput {
  swarmId: number;
  actor: string;
  run?: number;
  now: number;
}
export interface RevisionInput {
  expectedRevision?: number;
}
export class WorkConflictError extends BrokerError {
  constructor(
    readonly currentRevision: number,
    expectedRevision: number,
  ) {
    super(
      "validation",
      `Revision conflict: current ${currentRevision}, expected ${expectedRevision}. Reread before retrying.`,
      "expected_revision",
    );
    this.name = "WorkConflictError";
  }
}
export function checkRevision(revision: number, expected?: number, required = false): void {
  if (expected === undefined) {
    if (required)
      throw new BrokerError("validation", "expected_revision is required. Reread before editing.", "expected_revision");
    return;
  }
  if (!Number.isSafeInteger(expected) || expected < 0)
    throw new BrokerError("validation", "expected_revision must be a nonnegative safe integer.", "expected_revision");
  if (revision !== expected) throw new WorkConflictError(revision, expected);
}
export function workActor(db: SwarmDb, input: WorkInput): string {
  if (!Number.isSafeInteger(input.now) || input.now < 0)
    throw new BrokerError("validation", "now must be a nonnegative epoch millisecond timestamp.");
  requireSwarm(db, input.swarmId);
  const actor = actAs(db, input.swarmId, input.actor, input.now);
  if (actor.kind !== "agent" && actor.kind !== "user")
    throw new BrokerError("validation", "Only agents and User can change the work graph.");
  if (actor.kind === "agent" && input.run !== undefined) requireOpenRun(db, input.swarmId, input.run);
  if (
    actor.kind === "agent" &&
    !workRoster(db, input.swarmId).some((agent) => agent.name === actor.name && agent.active)
  )
    throw new BrokerError("validation", "Inactive agents cannot change the work graph.");
  return actor.name;
}
export function userOnly(actor: string): void {
  if (actor !== USER_NAME) throw new BrokerError("validation", "Only User can perform this action.");
}
export function isActiveOwner(db: SwarmDb, swarmId: number, name: string | null): boolean {
  return name === USER_NAME || workRoster(db, swarmId).some((agent) => agent.name === name && agent.active);
}
export function requireTask(db: SwarmDb, swarmId: number, id: number): TaskRecord {
  const task = getTask(db, swarmId, id);
  if (!task) throw new BrokerError("not_found", `Task #${id} not found in swarm #${swarmId}.`);
  return task;
}
export function requireCriterion(db: SwarmDb, swarmId: number, id: number, allowArchived = false): CriterionRecord {
  const criterion = getCriterion(db, swarmId, id);
  if (!criterion) throw new BrokerError("not_found", `Criterion #${id} not found in swarm #${swarmId}.`);
  if (!allowArchived && criterion.archivedAt !== null)
    throw new BrokerError("validation", `Criterion #${id} is archived. Ask User to restore it.`);
  return criterion;
}
export function workText(raw: string, field: string, actor: string, title = false, allowEmpty = false): string {
  const value = raw.trim();
  if (!value && !allowEmpty) throw new BrokerError("validation", `${field} is required.`, field);
  const size = charCount(value);
  const limit = title ? WORK_TITLE_ACCEPTED : WORK_TEXT_ACCEPTED;
  if ((title || actor !== USER_NAME) && size > limit) {
    throw new BrokerError(
      "validation",
      `${field} too long (${size} chars): keep it under ${title ? TITLE_MAX : TEXT_MAX}; put long material in a file and reference its path.`,
      field,
    );
  }
  return value;
}
