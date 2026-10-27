import type { CompletionGate, CompletionResult } from "../api-work-types.js";
import type { SwarmDb } from "../store/db.js";
import { listTasks, taskLinks } from "../store/tasks.js";
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
    gate("criteria", unmetCriteria.length, "Active criteria not satisfied or blocked with an approved exception."),
    gate("review", tasks.filter((task) => task.status === "review").length, "Tasks awaiting independent review."),
  ];
  const done = gates.every((item) => item.ok);
  const pendingExceptions = new Set(
    unmetCriteria
      .filter((criterion) => criterion.status === "blocked" && criterion.exception === "pending")
      .map((criterion) => criterion.id),
  );
  const agreedExceptions = new Set(
    criteria
      .filter((criterion) => criterion.status === "blocked" && ["approved", "pending"].includes(criterion.exception))
      .map((criterion) => criterion.id),
  );
  const unfinished = tasks.filter(
    (task) => task.status !== "accepted" && !states.some((state) => state.id === task.id && state.deferred),
  );
  const awaitingUser =
    !done &&
    (pendingExceptions.size > 0 || project.scopeApprovedRevision !== project.scopeRevision) &&
    gates.every((item) => item.ok || ["scope", "criteria", "tasks"].includes(item.key)) &&
    unmetCriteria.every((criterion) => pendingExceptions.has(criterion.id)) &&
    unfinished.every((task) => {
      const links = taskLinks(db, task.id);
      return links.length > 0 && links.every((link) => agreedExceptions.has(link.criterionId));
    });
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
