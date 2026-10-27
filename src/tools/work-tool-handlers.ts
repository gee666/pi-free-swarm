import type { Static } from "typebox";
import * as S from "./agent-schemas.js";
import { cursorAfter, nextCursor, workInput, type AgentToolIdentity } from "./agent-tool-context.js";
import { createTask, editTask } from "../broker/tasks.js";
import { claimTask, releaseTask, handoffTask } from "../broker/task-ownership.js";
import { startTask, requestTaskReview, reopenTask, reviewTask } from "../broker/task-transitions.js";
import { createCriterion, editCriterion, archiveCriterion } from "../broker/criteria.js";
import { recordCriterionBlocker } from "../broker/blockers.js";
import { voteCriterion } from "../broker/votes.js";
import { getCriterionDetail, getTaskDetail, criterionVoteContext, workDashboard } from "../broker/work-queries.js";
import { updateProjectIntent } from "../broker/project.js";
import { BrokerError } from "../broker/errors.js";
import type { TaskRecord } from "../api-work-types.js";

export function taskLine(task: TaskRecord & { dependencies?: TaskRecord[] }): string {
  const waiting = task.dependencies?.filter((dependency) => dependency.status !== "accepted") ?? [];
  return `#${task.id} [${task.status}] ${task.title} · owner ${task.owner ?? "none"}${waiting.length ? ` · waits ${waiting.map((item) => `#${item.id}`).join(", ")}` : ""}`;
}
export function projectText(identity: AgentToolIdentity): string {
  const dashboard = workDashboard(identity.getDb(), identity.swarmId, workInput(identity).now, identity.agentName);
  const { project, completion, queue } = dashboard;
  return [
    `Brief: ${project.briefPath ?? "not recorded"}`,
    `Intent r${project.intentRevision}: ${project.intentSummary ?? "not recorded"} · ${project.intentPath ?? "no file"}`,
    `Outcome: ${completion.outcome ?? "unfinished"}`,
    ...completion.gates.map((gate) => `${gate.ok ? "OK" : "UNMET"} ${gate.key} (${gate.count}): ${gate.detail}`),
    "Own tasks:",
    ...queue.tasks.map(taskLine),
    `Reviews: ${queue.reviews.map((task) => `#${task.id} ${task.title}`).join("; ") || "none"}`,
    `Votes needed: ${queue.criteria.map((criterion) => `#${criterion.id} ${criterion.title}`).join("; ") || "none"}`,
    "Tools: swarm_intent_update registers the intent file. swarm_criteria_search/get/create/edit/archive/block/vote define and assess scope; swarm_criteria_vote_context shows your voting duty. swarm_tasks_search/get/create/edit/claim/release/handoff/transition/review manage work and independent review. swarm_posts_search/get/create/comment/unsubscribe/link/unlink share discussion. swarm_messages_send/read continue one conversation per peer. swarm_skills_search/get find reusable automation. swarm_snooze pauses reminders; swarm_retire saves a handoff.",
  ].join("\n");
}
export function createWorkHandlers(identity: AgentToolIdentity) {
  const db = () => identity.getDb();
  const input = () => workInput(identity);
  const taskResult = (task: TaskRecord) => {
    const detail = getTaskDetail(db(), identity.swarmId, task.id);
    const waiting = detail.dependencies.filter((dependency) => dependency.status !== "accepted");
    return `Task #${task.id} r${task.revision} [${task.status}].${waiting.length ? ` Waiting on ${waiting.map((item) => `#${item.id}`).join(", ")} — you will be notified when they are accepted.` : ""}`;
  };
  const criterionResult = (id: number) => {
    const criterion = getCriterionDetail(db(), identity.swarmId, id);
    return `Criterion #${id} r${criterion.revision} [${criterion.archivedAt ? "archived" : criterion.status}].`;
  };
  return {
    project: () => projectText(identity),
    intentUpdate(params: Static<typeof S.intentUpdate>) {
      const project = updateProjectIntent(db(), { ...params, ...input() });
      return `Project #${identity.swarmId} r${project.intentRevision}.`;
    },
    criteriaGet: ({ id }: Static<typeof S.byId>) => JSON.stringify(getCriterionDetail(db(), identity.swarmId, id)),
    criteriaCreate(params: Static<typeof S.criteriaCreate>) {
      return criterionResult(createCriterion(db(), { ...params, ...input() }).id);
    },
    criteriaEdit({ id, expected_revision, ...fields }: Static<typeof S.criteriaEdit>) {
      return criterionResult(editCriterion(db(), { ...input(), id, expectedRevision: expected_revision, fields }).id);
    },
    criteriaArchive({ id }: Static<typeof S.byId>) {
      return criterionResult(archiveCriterion(db(), { ...input(), id }).id);
    },
    criteriaBlock({ criterion_id, ...fields }: Static<typeof S.criteriaBlock>) {
      const blocker = recordCriterionBlocker(db(), { ...fields, criterionId: criterion_id, ...input() });
      return `${criterionResult(criterion_id)} Blocker r${blocker.revision}; gather current blocked votes from every required owner and an independent voter to finalize the blocker. User may optionally reject it. Waiting for another task is a dependency, not a blocker.`;
    },
    criteriaVote({ criterion_id, ...fields }: Static<typeof S.criteriaVote>) {
      voteCriterion(db(), { ...fields, criterionId: criterion_id, ...input() });
      return criterionResult(criterion_id);
    },
    criteriaVoteContext(params: Static<typeof S.paged>) {
      const scope = `votes:${identity.swarmId}:${identity.agentName}`;
      const result = criterionVoteContext(
        db(),
        identity.swarmId,
        identity.agentName,
        cursorAfter(params.cursor, scope),
        params.limit,
      );
      return `${JSON.stringify(result)}\nNext cursor: ${nextCursor(result.nextAfter, scope) ?? "none"}`;
    },
    tasksGet(params: Static<typeof S.tasksGet>) {
      const scope = `task:${identity.swarmId}:${params.id}`;
      const result = getTaskDetail(db(), identity.swarmId, params.id, cursorAfter(params.cursor, scope), params.limit);
      return `${JSON.stringify(result)}\nNext cursor: ${nextCursor(result.nextAfter, scope) ?? "none"}`;
    },
    tasksCreate({ criteria, depends_on, ...fields }: Static<typeof S.tasksCreate>) {
      return taskResult(
        createTask(db(), {
          ...fields,
          ...input(),
          criteria: criteria.map(({ criterion_id, contribution }) => ({ criterionId: criterion_id, contribution })),
          dependsOn: depends_on,
        }),
      );
    },
    tasksEdit({ id, expected_revision, criteria, depends_on, ...fields }: Static<typeof S.tasksEdit>) {
      return taskResult(
        editTask(db(), {
          ...input(),
          id,
          expectedRevision: expected_revision,
          fields: {
            ...fields,
            ...(criteria
              ? {
                  criteria: criteria.map(({ criterion_id, contribution }) => ({
                    criterionId: criterion_id,
                    contribution,
                  })),
                }
              : {}),
            ...(depends_on ? { dependsOn: depends_on } : {}),
          },
        }),
      );
    },
    tasksClaim: ({ id }: Static<typeof S.byId>) => taskResult(claimTask(db(), { ...input(), id })),
    tasksRelease: ({ id }: Static<typeof S.byId>) => taskResult(releaseTask(db(), { ...input(), id })),
    tasksHandoff: (params: Static<typeof S.tasksHandoff>) => taskResult(handoffTask(db(), { ...params, ...input() })),
    tasksTransition({ id, action, evidence, reason }: Static<typeof S.tasksTransition>) {
      if (action === "start") return taskResult(startTask(db(), { ...input(), id }));
      const value = action === "request_review" ? evidence : reason;
      if (!value)
        throw new BrokerError(
          "validation",
          `${action === "request_review" ? "evidence" : "reason"} is required for ${action}.`,
        );
      return taskResult(
        action === "request_review"
          ? requestTaskReview(db(), { ...input(), id, evidence: value })
          : reopenTask(db(), { ...input(), id, reason: value }),
      );
    },
    tasksReview: (params: Static<typeof S.tasksReview>) => taskResult(reviewTask(db(), { ...params, ...input() })),
  };
}
