import {
  WORK_ACTIVITY_LIMIT,
  WORK_CONTEXT_PAGE_SIZE,
  WORK_QUEUE_LIMIT,
  USER_NAME,
  PAGE_MAX_COUNT,
} from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { criterionTasks, listCriteria } from "../store/criteria.js";
import { linkedPostIds } from "../store/post-links.js";
import { recentWorkActivity, workVelocity } from "../store/work-dashboard.js";
import {
  filteredCriterionCandidates,
  filteredTaskCandidates,
  type CriterionFilters,
  type TaskFilters,
} from "../store/work-search.js";
import { workRoster } from "../store/work-roster.js";
import { criterionStates, taskStates } from "../store/work-state.js";
import { latestTaskEvidence, listTasks, taskDependencies, taskLinks, taskTimeline } from "../store/tasks.js";
import { assessCriteriaWithTasks, assessCriterion } from "./criterion-status.js";
import { evaluateCompletion } from "./completion.js";
import { readProject } from "./project.js";
import { requireCriterion, requireTask } from "./work-validation.js";
import { requireParticipant } from "./validate.js";
import { BrokerError } from "./errors.js";

export function searchTaskCandidates(db: SwarmDb, swarmId: number, actor: string, filters: TaskFilters = {}) {
  return db.read(() => {
    const participant = requireParticipant(db, swarmId, actor);
    readProject(db, swarmId);
    return filteredTaskCandidates(db, swarmId, participant.name, filters);
  });
}
export function searchCriterionCandidates(db: SwarmDb, swarmId: number, actor: string, filters: CriterionFilters = {}) {
  return db.read(() => {
    const participant = requireParticipant(db, swarmId, actor);
    readProject(db, swarmId);
    return filteredCriterionCandidates(db, swarmId, participant.name, filters);
  });
}
export function getTaskDetail(db: SwarmDb, swarmId: number, id: number, after = 0, limit = WORK_ACTIVITY_LIMIT) {
  return db.read(() => {
    const task = requireTask(db, swarmId, id);
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > PAGE_MAX_COUNT
    )
      throw new BrokerError("validation", "Invalid timeline page.");
    const timeline = taskTimeline(db, id, after, limit + 1);
    return {
      ...task,
      handoffTargets: workRoster(db, swarmId)
        .filter((agent) => agent.active && agent.name !== task.owner)
        .map((agent) => agent.name),
      ...taskStates(db, swarmId).find((state) => state.id === id),
      criteria: taskLinks(db, id),
      dependencies: taskDependencies(db, id),
      dependents: taskDependencies(db, id, true),
      latestEvidence: latestTaskEvidence(db, id),
      timeline: timeline.slice(0, limit),
      nextAfter: timeline.length > limit ? (timeline[limit - 1]?.id ?? null) : null,
      linkedPosts: linkedPostIds(db, "task", id),
    };
  });
}
export function getCriterionDetail(db: SwarmDb, swarmId: number, id: number) {
  return db.read(() => {
    return {
      ...requireCriterion(db, swarmId, id, true),
      ...assessCriterion(db, swarmId, id),
      tasks: criterionTasks(db, id),
      linkedPosts: linkedPostIds(db, "criterion", id),
    };
  });
}
export function ownWorkQueue(db: SwarmDb, swarmId: number, actor: string) {
  return db.read(() => {
    const canonical = requireParticipant(db, swarmId, actor).name;
    return {
      tasks: listTasks(db, swarmId).filter((task) => task.owner === canonical && task.status !== "accepted"),
      criteria: filteredCriterionCandidates(db, swarmId, canonical, { needsMyVote: true }),
    };
  });
}
export function criterionVoteContext(
  db: SwarmDb,
  swarmId: number,
  actor: string,
  after = 0,
  limit = WORK_CONTEXT_PAGE_SIZE,
) {
  return db.read(() => {
    const canonical = requireParticipant(db, swarmId, actor).name;
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > PAGE_MAX_COUNT
    )
      throw new BrokerError("validation", "Invalid vote context page.");
    const ownTasks = listTasks(db, swarmId).filter((task) => task.owner === canonical);
    const assessments = new Map(assessCriteriaWithTasks(db, swarmId, true).map((item) => [item.id, item]));
    const ownIds = new Set(
      [...assessments.values()]
        .filter((item) => item.tasks.some((task) => task.owner === canonical))
        .map((item) => item.id),
    );
    const needed = new Set(
      filteredCriterionCandidates(db, swarmId, canonical, { needsMyVote: true }).map((item) => item.id),
    );
    const candidates = listCriteria(db, swarmId).filter(
      (criterion) => criterion.id > after && (ownIds.has(criterion.id) || needed.has(criterion.id)),
    );
    const page = candidates.slice(0, limit);
    const relevantIds = new Set(
      page.flatMap((criterion) => (assessments.get(criterion.id)?.tasks ?? []).map((task) => task.id)),
    );
    const relevantTasks = ownTasks.filter((task) => relevantIds.has(task.id));
    return {
      tasks: relevantTasks.slice(0, PAGE_MAX_COUNT).map(({ id, title, status }) => ({ id, title, status })),
      tasksTruncated: relevantTasks.length > PAGE_MAX_COUNT,
      criteria: page.map((criterion) => {
        const assessment = assessments.get(criterion.id);
        if (assessment === undefined) throw new Error(`Missing assessment #${criterion.id}.`);
        return {
          ...criterion,
          ...assessment,
          tasks: assessment.tasks
            .slice(0, PAGE_MAX_COUNT)
            .map((task) => ({ id: task.id, title: task.title, status: task.status, owner: task.owner })),
        };
      }),
      nextAfter: candidates.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  });
}
export function workDashboard(db: SwarmDb, swarmId: number, now: number, actor = USER_NAME) {
  return db.read(() => {
    const tasks = listTasks(db, swarmId);
    const criteria = criterionStates(db, swarmId);
    const states = taskStates(db, swarmId);
    const remaining = tasks.filter(
      (task) => task.status !== "accepted" && !states.find((state) => state.id === task.id)?.deferred,
    ).length;
    return {
      project: readProject(db, swarmId),
      completion: evaluateCompletion(db, swarmId),
      counts: {
        tasks: tasks.length,
        accepted: tasks.filter((task) => task.status === "accepted").length,
        remaining,
        criteria: criteria.length,
        unlinked: criteria.filter((criterion) => criterion.status === "unlinked").length,
      },
      velocity: workVelocity(db, swarmId, now, remaining),
      recentActivity: recentWorkActivity(db, swarmId, WORK_ACTIVITY_LIMIT),
      queue: ownWorkQueue(db, swarmId, actor),
      runnable: filteredTaskCandidates(db, swarmId, actor, { runnable: true }).slice(0, WORK_QUEUE_LIMIT),
    };
  });
}
