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
import { assignedReviews, recentWorkActivity, workVelocity } from "../store/work-dashboard.js";
import {
  filteredCriterionCandidates,
  filteredTaskCandidates,
  type CriterionFilters,
  type TaskFilters,
} from "../store/work-search.js";
import { workRoster } from "../store/work-roster.js";
import { taskStates } from "../store/work-state.js";
import { latestTaskEvidence, listTasks, taskDependencies, taskLinks, taskTimeline } from "../store/tasks.js";
import { assessCriteria, assessCriterion } from "./criterion-status.js";
import { evaluateCompletion } from "./completion.js";
import { readProject } from "./project.js";
import { requireCriterion, requireTask } from "./work-validation.js";
import { requireParticipant } from "./validate.js";
import { BrokerError } from "./errors.js";

export function searchTaskCandidates(db: SwarmDb, swarmId: number, actor: string, filters: TaskFilters = {}) {
  const participant = requireParticipant(db, swarmId, actor);
  readProject(db, swarmId);
  return filteredTaskCandidates(db, swarmId, participant.name, filters);
}
export function searchCriterionCandidates(db: SwarmDb, swarmId: number, actor: string, filters: CriterionFilters = {}) {
  const participant = requireParticipant(db, swarmId, actor);
  readProject(db, swarmId);
  return filteredCriterionCandidates(db, swarmId, participant.name, filters);
}
export function getTaskDetail(db: SwarmDb, swarmId: number, id: number, after = 0, limit = WORK_ACTIVITY_LIMIT) {
  const task = requireTask(db, swarmId, id);
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_MAX_COUNT)
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
}
export function getCriterionDetail(db: SwarmDb, swarmId: number, id: number) {
  return {
    ...requireCriterion(db, swarmId, id, true),
    ...assessCriterion(db, swarmId, id),
    tasks: criterionTasks(db, id),
    linkedPosts: linkedPostIds(db, "criterion", id),
  };
}
export function ownWorkQueue(db: SwarmDb, swarmId: number, actor: string) {
  const canonical = requireParticipant(db, swarmId, actor).name;
  return {
    tasks: listTasks(db, swarmId).filter((task) => task.owner === canonical && task.status !== "accepted"),
    reviews: assignedReviews(db, swarmId, canonical),
    criteria: filteredCriterionCandidates(db, swarmId, canonical, { needsMyVote: true }),
  };
}
export function criterionVoteContext(
  db: SwarmDb,
  swarmId: number,
  actor: string,
  after = 0,
  limit = WORK_CONTEXT_PAGE_SIZE,
) {
  const canonical = requireParticipant(db, swarmId, actor).name;
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_MAX_COUNT)
    throw new BrokerError("validation", "Invalid vote context page.");
  const ownTasks = listTasks(db, swarmId).filter((task) => task.owner === canonical);
  const ownIds = new Set(ownTasks.flatMap((task) => taskLinks(db, task.id).map((link) => link.criterionId)));
  const needed = new Set(
    filteredCriterionCandidates(db, swarmId, canonical, { needsMyVote: true }).map((item) => item.id),
  );
  const candidates = listCriteria(db, swarmId).filter(
    (criterion) => criterion.id > after && (ownIds.has(criterion.id) || needed.has(criterion.id)),
  );
  const page = candidates.slice(0, limit);
  const relevantTasks = ownTasks.filter((task) =>
    taskLinks(db, task.id).some((link) => page.some((criterion) => criterion.id === link.criterionId)),
  );
  return {
    tasks: relevantTasks.slice(0, PAGE_MAX_COUNT).map(({ id, title, status }) => ({ id, title, status })),
    tasksTruncated: relevantTasks.length > PAGE_MAX_COUNT,
    criteria: page.map((criterion) => ({
      ...criterion,
      ...assessCriterion(db, swarmId, criterion.id),
      tasks: criterionTasks(db, criterion.id)
        .slice(0, PAGE_MAX_COUNT)
        .map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          owner: task.owner,
        })),
    })),
    nextAfter: candidates.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}
export function workDashboard(db: SwarmDb, swarmId: number, now: number, actor = USER_NAME) {
  const tasks = listTasks(db, swarmId);
  const assessments = new Map(assessCriteria(db, swarmId).map((criterion) => [criterion.id, criterion]));
  const criteria = listCriteria(db, swarmId).map((criterion) => ({ ...criterion, ...assessments.get(criterion.id) }));
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
    attention: criteria.filter(
      (criterion) =>
        criterion.status === "unlinked" || (criterion.status === "blocked" && criterion.exception === "pending"),
    ),
    queue: ownWorkQueue(db, swarmId, actor),
    runnable: filteredTaskCandidates(db, swarmId, actor, { runnable: true }).slice(0, WORK_QUEUE_LIMIT),
  };
}
