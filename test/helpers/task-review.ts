import type { SwarmDb } from "../../src/store/db.js";
import { getTask } from "../../src/store/tasks.js";
import { finishTaskReview, type ReviewVerdict } from "../../src/broker/task-review.js";
import type { WorkInput } from "../../src/broker/work-validation.js";

export function finishReview(db: SwarmDb, input: WorkInput & { id: number; verdict: ReviewVerdict; reason: string }) {
  const task = getTask(db, input.swarmId, input.id);
  if (!task || !task.owner) throw new Error("Fixture review needs an owned task.");
  return finishTaskReview(db, { ...input, actor: task.owner, revision: task.revision });
}
