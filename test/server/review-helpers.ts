import { beginTaskReview } from "../../src/broker/task-review.js";
import { handoffTask } from "../../src/broker/task-ownership.js";
import { getTask } from "../../src/store/tasks.js";
import { finishReview } from "../helpers/task-review.js";
import type { WorkBoard } from "./work-helpers.js";

export function requestReview(board: WorkBoard, id: number, context: string) {
  const { db } = board.temp;
  const task = getTask(db, board.swarm.id, id);
  if (!task?.owner) throw new Error("Review fixture requires an owner");
  if (task.owner === "User")
    handoffTask(db, { swarmId: board.swarm.id, id, actor: "User", to: "Maria", now: Date.now() });
  return beginTaskReview(db, {
    swarmId: board.swarm.id,
    id,
    actor: task.owner === "User" ? "Maria" : task.owner,
    context,
    now: Date.now(),
  }).task;
}
export function reviewResult(board: WorkBoard, id: number, verdict: "accept" | "changes", reason: string) {
  return finishReview(board.temp.db, { swarmId: board.swarm.id, id, actor: "Maria", verdict, reason, now: Date.now() });
}
