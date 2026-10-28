import type { CriterionBlocker, CriterionVote, TaskRecord } from "../api-work-types.js";
import type { SwarmDb } from "./db.js";
import { int } from "./rows.js";
import { blockerOf, taskOf, voteOf } from "./work-rows.js";

function append<T>(map: Map<number, T[]>, id: number, value: T): void {
  const items = map.get(id);
  if (items) items.push(value);
  else map.set(id, [value]);
}

export function criterionRelations(db: SwarmDb, swarmId: number, id?: number) {
  const tasks = new Map<number, TaskRecord[]>();
  const votes = new Map<number, CriterionVote[]>();
  const blockers = new Map<number, CriterionBlocker>();
  const where = "c.swarm_id = ? AND (? IS NULL OR c.id = ?)";
  for (const row of db.sql
    .prepare(
      `SELECT t.*, l.criterion_id FROM task_criteria l
    JOIN tasks t ON t.id = l.task_id JOIN criteria c ON c.id = l.criterion_id
    WHERE ${where} ORDER BY t.id`,
    )
    .all(swarmId, id ?? null, id ?? null)) {
    append(tasks, int(row, "criterion_id"), taskOf(row));
  }
  for (const row of db.sql
    .prepare(
      `SELECT v.* FROM criterion_votes v JOIN criteria c ON c.id = v.criterion_id
    WHERE ${where} ORDER BY v.voter`,
    )
    .all(swarmId, id ?? null, id ?? null)) {
    append(votes, int(row, "criterion_id"), voteOf(row));
  }
  for (const row of db.sql
    .prepare(
      `SELECT b.* FROM criterion_blockers b JOIN criteria c ON c.id = b.criterion_id
    WHERE ${where}`,
    )
    .all(swarmId, id ?? null, id ?? null)) {
    const blocker = blockerOf(row);
    blockers.set(blocker.criterionId, blocker);
  }
  return { tasks, votes, blockers };
}
