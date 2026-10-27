import type {
  CriteriaGroupsResponse,
  CriteriaResponse,
  DashboardResponse,
  TaskDetailResponse,
  TasksResponse,
} from "../api-types.js";
import { searchCriterionCandidates, searchTaskCandidates } from "../broker/work-queries.js";
import { USER_NAME, WORK_ACTIVITY_LIMIT } from "../constants.js";
import { runSearch } from "../search/index.js";
import { reply, requireSwarmItem, intQuery, type ApiDeps, type ApiRoute } from "./api-util.js";
import { booleanQuery, positiveQuery, searchQuery, statuses, textQuery } from "./work-input.js";
import {
  criteriaCoverage,
  criterionDetail,
  criterionListItem,
  criterionListItems,
  taskDetail,
  taskListItem,
} from "./work-projection.js";
import { dashboard } from "./dashboard-projection.js";

export function workReadRoutes(deps: ApiDeps): ApiRoute[] {
  const { db, clock } = deps;
  return [
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/dashboard",
      handle: ({ params }) =>
        db.read(() =>
          reply<DashboardResponse>(dashboard(db, requireSwarmItem(deps, params.id("swarmId")), clock.now())),
        ),
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/criteria",
      handle: async ({ params, url }) => {
        const candidates = db.read(() => {
          const swarm = requireSwarmItem(deps, params.id("swarmId"));
          return searchCriterionCandidates(db, swarm.id, USER_NAME, {
            status: statuses(url, ["unlinked", "incomplete", "satisfied", "blocked"]),
            group: textQuery(url, "group"),
            taskId: positiveQuery(url, "taskId"),
            author: textQuery(url, "author"),
            needsMyVote: booleanQuery(url, "needsMyVote"),
            includeArchived: booleanQuery(url, "includeArchived"),
          }).map((item) => ({ ...item, id: String(item.id), view: criterionListItem(db, swarm.id, item.id) }));
        });
        const result = await runSearch({
          db,
          kind: "criterion",
          candidates,
          ...searchQuery(url),
        });
        return reply<CriteriaResponse>({
          ...result,
          items: result.items.map((item) => item.view),
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/criteria/groups",
      handle: ({ params, url }) => {
        return deps.db.read(() => {
          const swarm = requireSwarmItem(deps, params.id("swarmId"));
          const groups = criteriaCoverage(criterionListItems(db, swarm.id, booleanQuery(url, "includeArchived")));
          return reply<CriteriaGroupsResponse>({ groups });
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/criteria/:criterionId",
      handle: ({ params }) => {
        return deps.db.read(() => {
          const swarm = requireSwarmItem(deps, params.id("swarmId"));
          return reply(criterionDetail(db, swarm.id, params.id("criterionId")));
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/tasks",
      handle: async ({ params, url }) => {
        const candidates = db.read(() => {
          const swarm = requireSwarmItem(deps, params.id("swarmId"));
          return searchTaskCandidates(db, swarm.id, USER_NAME, {
            status: statuses(url, ["new", "claimed", "in_progress", "review", "accepted"]),
            owner: textQuery(url, "owner"),
            author: textQuery(url, "author"),
            criterionId: positiveQuery(url, "criterionId"),
            runnable: booleanQuery(url, "runnable"),
            waiting: booleanQuery(url, "waiting"),
            deferred: booleanQuery(url, "deferred"),
          }).map((item) => ({ ...item, id: String(item.id), view: taskListItem(db, swarm.id, item.id) }));
        });
        const result = await runSearch({
          db,
          kind: "task",
          candidates,
          ...searchQuery(url),
        });
        return reply<TasksResponse>({
          ...result,
          items: result.items.map((item) => item.view),
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/tasks/:taskId",
      handle: ({ params, url }) => {
        return deps.db.read(() => {
          const swarm = requireSwarmItem(deps, params.id("swarmId"));
          return reply<TaskDetailResponse>(
            taskDetail(
              db,
              swarm.id,
              params.id("taskId"),
              intQuery(url, "after", 0),
              intQuery(url, "limit", WORK_ACTIVITY_LIMIT),
            ),
          );
        });
      },
    },
  ];
}
