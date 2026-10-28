import type { TaskRecord } from "../api-work-types.js";
import type { SwarmDb } from "./db.js";
import { int } from "./rows.js";
import { taskOf } from "./work-rows.js";
import { listTasks } from "./tasks.js";
import { taskStates } from "./work-state.js";

export function taskListRecords(db: SwarmDb, swarmId: number) {
  const dependencies = new Map<number, TaskRecord[]>();
  for (const row of db.sql
    .prepare(
      `SELECT dep.*, d.task_id FROM task_dependencies d
    JOIN tasks t ON t.id = d.task_id JOIN tasks dep ON dep.id = d.depends_on
    WHERE t.swarm_id = ? ORDER BY dep.id`,
    )
    .all(swarmId)) {
    const id = int(row, "task_id");
    const items = dependencies.get(id) ?? [];
    items.push(taskOf(row));
    dependencies.set(id, items);
  }
  const states = new Map(taskStates(db, swarmId).map((state) => [state.id, state]));
  return listTasks(db, swarmId).map((task) => {
    const state = states.get(task.id);
    if (state === undefined) throw new Error(`Missing task state #${task.id}.`);
    return { ...task, ...state, dependencies: dependencies.get(task.id) ?? [] };
  });
}
