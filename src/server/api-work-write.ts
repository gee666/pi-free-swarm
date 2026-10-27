import type {
  CriterionBlockerResponse,
  CriterionMutationResponse,
  CriterionVoteResponse,
  TaskMutationResponse,
} from "../api-types.js";
import { createCriterion, editCriterion, archiveCriterion, restoreCriterion } from "../broker/criteria.js";
import { voteCriterion } from "../broker/votes.js";
import { recordCriterionBlocker, decideCriterionBlocker } from "../broker/blockers.js";
import { createTask, editTask } from "../broker/tasks.js";
import { claimTask, releaseTask, handoffTask } from "../broker/task-ownership.js";
import { startTask, requestTaskReview, reviewTask, reopenTask } from "../broker/task-transitions.js";
import { USER_NAME } from "../constants.js";
import {
  integerField,
  readWorkBody,
  revision,
  recordField,
  choice,
  criterionFields,
  createCriterionFields,
  taskFields,
  createTaskFields,
} from "./work-input.js";
import {
  reply,
  requireSwarmItem,
  stringField,
  type ApiDeps,
  type ApiRoute,
  type Reply,
  type RouteParams,
} from "./api-util.js";

interface MutationContext {
  body: Record<string, unknown>;
  params: RouteParams;
  input: { swarmId: number; actor: string; now: number; expectedRevision?: number };
}
function mutation(deps: ApiDeps, path: string, handle: (ctx: MutationContext) => Reply): ApiRoute {
  return {
    method: "POST",
    pattern: `/api/swarms/:swarmId/${path}`,
    handle: async ({ req, params }) => {
      const swarm = requireSwarmItem(deps, params.id("swarmId"));
      const body = await readWorkBody(req);
      return handle({
        body,
        params,
        input: {
          swarmId: swarm.id,
          actor: USER_NAME,
          now: deps.clock.now(),
          expectedRevision: revision(body),
        },
      });
    },
  };
}
export function workWriteRoutes(deps: ApiDeps): ApiRoute[] {
  const { db } = deps;
  const route = (path: string, handle: (ctx: MutationContext) => Reply) => mutation(deps, path, handle);
  const transition = ({ input, params, body }: MutationContext, action: "start" | "request_review" | "reopen") => {
    const taskInput = { ...input, id: params.id("taskId") };
    if (action === "start") return reply<TaskMutationResponse>(startTask(db, taskInput));
    if (action === "request_review")
      return reply<TaskMutationResponse>(
        requestTaskReview(db, { ...taskInput, evidence: stringField(body, "evidence") }),
      );
    return reply<TaskMutationResponse>(reopenTask(db, { ...taskInput, reason: stringField(body, "reason") }));
  };
  return [
    route("criteria", ({ input, body }) =>
      reply<CriterionMutationResponse>(createCriterion(db, { ...input, ...createCriterionFields(body) }), 201),
    ),
    route("criteria/:criterionId/edit", ({ input, body, params }) =>
      reply<CriterionMutationResponse>(
        editCriterion(db, {
          ...input,
          id: params.id("criterionId"),
          expectedRevision: integerField(body, "expectedRevision"),
          fields: criterionFields(recordField(body.fields, "fields")),
        }),
      ),
    ),
    route("criteria/:criterionId/archive", ({ input, params }) =>
      reply<CriterionMutationResponse>(archiveCriterion(db, { ...input, id: params.id("criterionId") })),
    ),
    route("criteria/:criterionId/restore", ({ input, params }) =>
      reply<CriterionMutationResponse>(restoreCriterion(db, { ...input, id: params.id("criterionId") })),
    ),
    route("criteria/:criterionId/vote", ({ input, params, body }) =>
      reply<CriterionVoteResponse>(
        voteCriterion(db, {
          ...input,
          criterionId: params.id("criterionId"),
          verdict: choice(body.verdict, ["covered", "gap", "blocked"], "verdict"),
          reason: stringField(body, "reason"),
        }),
      ),
    ),
    route("criteria/:criterionId/block", ({ input, params, body }) =>
      reply<CriterionBlockerResponse>(
        recordCriterionBlocker(db, {
          ...input,
          criterionId: params.id("criterionId"),
          reason: stringField(body, "reason"),
          missing: stringField(body, "missing"),
          attempted: stringField(body, "attempted"),
          unblock: stringField(body, "unblock"),
        }),
      ),
    ),
    route("criteria/:criterionId/blocker-decision", ({ input, params, body }) =>
      reply<CriterionBlockerResponse>(
        decideCriterionBlocker(db, {
          ...input,
          criterionId: params.id("criterionId"),
          decision: choice(body.decision, ["reject"], "decision"),
        }),
      ),
    ),
    route("tasks", ({ input, body }) =>
      reply<TaskMutationResponse>(createTask(db, { ...input, ...createTaskFields(body) }), 201),
    ),
    route("tasks/:taskId/edit", ({ input, params, body }) =>
      reply<TaskMutationResponse>(
        editTask(db, {
          ...input,
          id: params.id("taskId"),
          expectedRevision: integerField(body, "expectedRevision"),
          fields: taskFields(recordField(body.fields, "fields")),
        }),
      ),
    ),
    route("tasks/:taskId/claim", ({ input, params }) =>
      reply<TaskMutationResponse>(claimTask(db, { ...input, id: params.id("taskId") })),
    ),
    route("tasks/:taskId/release", ({ input, params }) =>
      reply<TaskMutationResponse>(releaseTask(db, { ...input, id: params.id("taskId") })),
    ),
    route("tasks/:taskId/handoff", ({ input, params, body }) =>
      reply<TaskMutationResponse>(handoffTask(db, { ...input, id: params.id("taskId"), to: stringField(body, "to") })),
    ),
    route("tasks/:taskId/start", (ctx) => transition(ctx, "start")),
    route("tasks/:taskId/request-review", (ctx) => transition(ctx, "request_review")),
    route("tasks/:taskId/review", ({ input, params, body }) =>
      reply<TaskMutationResponse>(
        reviewTask(db, {
          ...input,
          id: params.id("taskId"),
          verdict: choice(body.verdict, ["accept", "changes"], "verdict"),
          reason: stringField(body, "reason"),
        }),
      ),
    ),
    route("tasks/:taskId/reopen", (ctx) => transition(ctx, "reopen")),
  ];
}
