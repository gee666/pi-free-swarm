import type { CompletionGate, CompletionResult } from "../api-work-types.js";
import type { SwarmDb } from "../store/db.js";
import { listTasks } from "../store/tasks.js";
import { criterionStates, taskStates } from "../store/work-state.js";
import { readProject } from "./project.js";

export function evaluateCompletion(db: SwarmDb, swarmId: number): CompletionResult {
  const project = readProject(db, swarmId);
  const criteria = criterionStates(db, swarmId);
  const tasks = listTasks(db, swarmId);
  const states = taskStates(db, swarmId);
  const gate = (key: CompletionGate["key"], count: number, detail: string): CompletionGate => ({
    key,
    ok: count === 0,
    count,
    detail,
  });
  const unmetCriteria = criteria.filter(
    (criterion) =>
      criterion.status !== "satisfied" && !(criterion.status === "blocked" && criterion.exception === "approved"),
  );
  const gates: CompletionGate[] = [
    gate(
      "scope",
      project.scopeApprovedRevision === project.scopeRevision ? 0 : 1,
      `Scope revision ${project.scopeRevision} ${project.scopeApprovedRevision === project.scopeRevision ? "approved" : "needs User approval"}.`,
    ),
    gate(
      "linked",
      criteria.filter((criterion) => criterion.status === "unlinked").length,
      "Active criteria without linked tasks.",
    ),
    gate(
      "tasks",
      tasks.filter(
        (task) => task.status !== "accepted" && !states.some((state) => state.id === task.id && state.deferred),
      ).length,
      "Tasks not accepted or deferred.",
    ),
    gate("criteria", unmetCriteria.length, "Active criteria not satisfied or blocked with an approved exception."),
    gate("review", tasks.filter((task) => task.status === "review").length, "Tasks awaiting independent review."),
  ];
  const done = gates.every((item) => item.ok);
  const awaitingUser =
    !done &&
    gates.every((item) => item.ok || item.key === "scope" || item.key === "criteria") &&
    unmetCriteria.every((criterion) => criterion.status === "blocked" && criterion.exception === "pending");
  return {
    done,
    gates,
    awaitingUser,
    outcome: done
      ? criteria.some((criterion) => criterion.status === "blocked" && criterion.exception === "approved")
        ? "stopped_with_blockers"
        : "completed"
      : null,
  };
}
