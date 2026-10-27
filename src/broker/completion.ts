import type { CompletionGate, CompletionResult } from "../api-work-types.js";
import type { SwarmDb } from "../store/db.js";
import { listTasks } from "../store/tasks.js";
import { criterionStates, taskStates } from "../store/work-state.js";

export function evaluateCompletion(db: SwarmDb, swarmId: number): CompletionResult {
  return db.read(() => {
    const criteria = criterionStates(db, swarmId);
    const tasks = listTasks(db, swarmId);
    const states = taskStates(db, swarmId);
    const gate = (key: CompletionGate["key"], count: number, detail: string): CompletionGate => ({
      key,
      ok: count === 0,
      count,
      detail,
    });
    const gates: CompletionGate[] = [
      gate(
        "linked",
        criteria.length === 0 ? 1 : criteria.filter((criterion) => criterion.status === "unlinked").length,
        "At least one active criterion is required, and each must have linked tasks.",
      ),
      gate(
        "tasks",
        tasks.filter(
          (task) => task.status !== "accepted" && !states.some((state) => state.id === task.id && state.deferred),
        ).length,
        "Tasks not accepted or deferred.",
      ),
      gate(
        "criteria",
        criteria.filter((criterion) => criterion.status !== "satisfied" && criterion.status !== "blocked").length,
        "Active criteria not satisfied or blocked.",
      ),
      gate("review", tasks.filter((task) => task.status === "review").length, "Tasks awaiting independent review."),
    ];
    const done = gates.every((item) => item.ok);
    return {
      done,
      gates,
      outcome: done
        ? criteria.some((criterion) => criterion.status === "blocked")
          ? "stopped_with_blockers"
          : "completed"
        : null,
    };
  });
}
