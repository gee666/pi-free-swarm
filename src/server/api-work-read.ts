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
import { booleanQuery, positiveQuery, searchQuery, searchSettings, statuses, textQuery } from "./work-input.js";
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
        reply<DashboardResponse>(dashboard(db, requireSwarmItem(deps, params.id("swarmId")), clock.now())),
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/criteria",
      handle: async ({ params, url }) => {
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const candidates = searchCriterionCandidates(db, swarm.id, USER_NAME, {
          status: statuses(url, ["unlinked", "incomplete", "satisfied", "blocked"]),
          group: textQuery(url, "group"),
          taskId: positiveQuery(url, "taskId"),
          author: textQuery(url, "author"),
          needsMyVote: booleanQuery(url, "needsMyVote"),
          includeArchived: booleanQuery(url, "includeArchived"),
        }).map((item) => ({ ...item, id: String(item.id) }));
        const result = await runSearch({
          db,
          kind: "criterion",
          candidates,
          ...searchQuery(url),
          settings: searchSettings(db),
        });
        return reply<CriteriaResponse>({
          ...result,
          items: result.items.map((item) => criterionListItem(db, swarm.id, Number(item.id))),
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/criteria/groups",
      handle: ({ params, url }) => {
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const groups = criteriaCoverage(criterionListItems(db, swarm.id, booleanQuery(url, "includeArchived")));
        return reply<CriteriaGroupsResponse>({ groups });
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/criteria/:criterionId",
      handle: ({ params }) => {
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        return reply(criterionDetail(db, swarm.id, params.id("criterionId")));
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/tasks",
      handle: async ({ params, url }) => {
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const candidates = searchTaskCandidates(db, swarm.id, USER_NAME, {
          status: statuses(url, ["new", "claimed", "in_progress", "review", "accepted"]),
          owner: textQuery(url, "owner"),
          author: textQuery(url, "author"),
          criterionId: positiveQuery(url, "criterionId"),
          runnable: booleanQuery(url, "runnable"),
          waiting: booleanQuery(url, "waiting"),
          deferred: booleanQuery(url, "deferred"),
        }).map((item) => ({ ...item, id: String(item.id) }));
        const result = await runSearch({
          db,
          kind: "task",
          candidates,
          ...searchQuery(url),
          settings: searchSettings(db),
        });
        return reply<TasksResponse>({
          ...result,
          items: result.items.map((item) => taskListItem(db, swarm.id, Number(item.id))),
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/tasks/:taskId",
      handle: ({ params, url }) => {
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
      },
    },
  ];
}
