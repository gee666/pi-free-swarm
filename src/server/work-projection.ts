import type {
  CriteriaCoverage,
  CriterionDetailResponse,
  CriterionListItem,
  PostLinkView,
  PostSummary,
  TaskDetailResponse,
  TaskListItem,
  TaskUserAction,
  VoteProgress,
} from "../api-types.js";
import { getCriterionDetail, getTaskDetail } from "../broker/work-queries.js";
import { assessCriteria } from "../broker/criterion-status.js";
import { criterionTasks, listCriteria } from "../store/criteria.js";
import { USER_NAME, WORK_ACTIVITY_LIMIT } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { listPostLinks } from "../store/post-links.js";
import { taskLinks } from "../store/tasks.js";
import { workRoster } from "../store/work-roster.js";
import { taskEventOf } from "../store/work-rows.js";
import { getPost } from "../store/wall-queries.js";
import { postsForUser } from "../store/user-post-state.js";

type CriterionDetail = Omit<ReturnType<typeof getCriterionDetail>, "linkedPosts">;
type TaskDetail = ReturnType<typeof getTaskDetail>;
function progress(detail: CriterionDetail, verdict: "covered" | "blocked"): VoteProgress {
  const votes = detail.votes.filter((vote) => !vote.stale && vote.verdict === verdict);
  const owners = new Set(detail.tasks.flatMap((task) => (task.owner === null ? [] : [task.owner])));
  const current =
    detail.requiredOwners.filter((owner) => votes.some((vote) => vote.voter === owner)).length +
    Number(votes.some((vote) => !owners.has(vote.voter)));
  const required = detail.requiredOwners.length + 1;
  return { current, required, label: `${current}/${required}` };
}
function listCriterion(detail: CriterionDetail): CriterionListItem {
  const blocked = detail.blocker !== null && detail.votes.some((vote) => !vote.stale && vote.verdict === "blocked");
  return {
    id: detail.id,
    swarmId: detail.swarmId,
    group: detail.group,
    title: detail.title,
    body: detail.body,
    verification: detail.verification,
    source: detail.source,
    author: detail.author,
    updatedBy: detail.updatedBy,
    revision: detail.revision,
    archivedAt: detail.archivedAt,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    status: detail.status,
    linkedTaskCount: detail.tasks.length,
    voteProgress: progress(detail, blocked ? "blocked" : "covered"),
    reasons: detail.reasons,
  };
}
export function criteriaCoverage(criteria: readonly Pick<CriterionListItem, "group" | "status">[]): CriteriaCoverage[] {
  const groups = new Map<string, CriteriaCoverage>();
  for (const criterion of criteria) {
    const coverage = groups.get(criterion.group) ?? {
      group: criterion.group,
      satisfied: 0,
      blocked: 0,
      incomplete: 0,
      unlinked: 0,
      total: 0,
    };
    coverage[criterion.status]++;
    coverage.total++;
    groups.set(criterion.group, coverage);
  }
  return [...groups.values()].sort((a, b) => a.group.localeCompare(b.group));
}
export function criterionListItems(db: SwarmDb, swarmId: number, includeArchived = false): CriterionListItem[] {
  return db.read(() => {
    const assessments = new Map(assessCriteria(db, swarmId, includeArchived).map((item) => [item.id, item]));
    return listCriteria(db, swarmId, includeArchived).map((criterion) => {
      const assessment = assessments.get(criterion.id);
      if (assessment === undefined) throw new Error(`Missing assessment for criterion #${criterion.id}.`);
      return listCriterion({ ...criterion, ...assessment, tasks: criterionTasks(db, criterion.id) });
    });
  });
}
export function criterionListItem(db: SwarmDb, swarmId: number, id: number): CriterionListItem {
  return db.read(() => {
    return listCriterion(getCriterionDetail(db, swarmId, id));
  });
}
function linkedPosts(db: SwarmDb, swarmId: number, ids: readonly number[]): PostSummary[] {
  return postsForUser(
    db,
    swarmId,
    ids.flatMap((id) => {
      const post = getPost(db, swarmId, id);
      return post === null ? [] : [post];
    }),
  );
}
export function criterionDetail(db: SwarmDb, swarmId: number, id: number): CriterionDetailResponse {
  return db.read(() => {
    const detail = getCriterionDetail(db, swarmId, id);
    const owners = new Set(detail.tasks.flatMap((task) => (task.owner === null ? [] : [task.owner])));
    const item = listCriterion(detail);
    return {
      ...item,
      tasks: detail.tasks.map((task) => ({
        ...task,
        contribution: taskLinks(db, task.id).find((link) => link.criterionId === id)?.contribution ?? "",
      })),
      votes: detail.votes.map((vote) => ({ ...vote, role: owners.has(vote.voter) ? "owner" : "independent" })),
      requiredOwners: detail.requiredOwners,
      offlineTasks: detail.offlineTasks,
      missingVoters:
        detail.blocker && detail.votes.some((vote) => !vote.stale && vote.verdict === "blocked")
          ? detail.missingBlocked
          : detail.missingCovered,
      missingCovered: detail.missingCovered,
      missingBlocked: detail.missingBlocked,
      blocker: detail.blocker,
      agreement: progress(detail, "blocked"),
      linkedPosts: linkedPosts(db, swarmId, detail.linkedPosts),
    };
  });
}
function latestEvent(db: SwarmDb, taskId: number, kinds: readonly string[]) {
  const row = db.sql
    .prepare(
      `SELECT * FROM task_events WHERE task_id = ?
    AND kind IN (${kinds.map(() => "?").join(",")}) ORDER BY id DESC LIMIT 1`,
    )
    .get(taskId, ...kinds);
  return row === undefined ? null : taskEventOf(row);
}
function listTask(detail: TaskDetail): TaskListItem {
  if (detail.waiting === undefined || detail.runnable === undefined || detail.deferred === undefined)
    throw new Error(`Missing derived state for task #${detail.id}.`);
  return {
    id: detail.id,
    swarmId: detail.swarmId,
    title: detail.title,
    body: detail.body,
    status: detail.status,
    owner: detail.owner,
    author: detail.author,
    revision: detail.revision,
    contentRevision: detail.contentRevision,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    acceptedAt: detail.acceptedAt,
    acceptedBy: detail.acceptedBy,
    waitsOn: detail.dependencies.filter((task) => task.status !== "accepted").map((task) => task.id),
    waiting: detail.waiting,
    runnable: detail.runnable,
    deferred: detail.deferred,
  };
}
export function taskListItem(db: SwarmDb, swarmId: number, id: number): TaskListItem {
  return db.read(() => {
    return listTask(getTaskDetail(db, swarmId, id));
  });
}
function validActions(db: SwarmDb, task: TaskListItem): TaskUserAction[] {
  const agents = workRoster(db, task.swarmId).filter((agent) => agent.active);
  const activeOwner = task.owner === USER_NAME || agents.some((agent) => agent.name === task.owner);
  const actions: TaskUserAction[] = ["edit"];
  if (task.status === "new" || (task.owner !== null && !activeOwner)) actions.push("claim");
  if (task.owner !== null && task.status !== "review") actions.push("release");
  if (task.owner !== null && task.status !== "review" && agents.some((agent) => agent.name !== task.owner))
    actions.push("handoff");
  if (task.status === "claimed" && !task.waiting) actions.push("start");
  if (task.status === "accepted") actions.push("reopen");
  return actions;
}
export function taskDetail(
  db: SwarmDb,
  swarmId: number,
  id: number,
  after = 0,
  limit = WORK_ACTIVITY_LIMIT,
): TaskDetailResponse {
  return db.read(() => {
    const detail = getTaskDetail(db, swarmId, id, after, limit);
    const item = listTask(detail);
    const evidence = latestEvent(db, id, ["review_requested"]);
    const verdict = latestEvent(db, id, ["review_accepted", "changes_requested"]);
    return {
      ...item,
      criteria: detail.criteria.map((link) => {
        const criterion = getCriterionDetail(db, swarmId, link.criterionId);
        return { ...link, title: criterion.title, status: criterion.status };
      }),
      dependencies: detail.dependencies,
      dependents: detail.dependents,
      latestEvidence: detail.latestEvidence,
      evidence,
      reviewVerdict: evidence !== null && verdict !== null && verdict.id > evidence.id ? verdict : null,
      timeline: detail.timeline,
      nextAfter: detail.nextAfter,
      linkedPosts: linkedPosts(db, swarmId, detail.linkedPosts),
      validActions: validActions(db, item),
      handoffTargets: detail.handoffTargets,
    };
  });
}
export function postLinks(db: SwarmDb, swarmId: number, postId: number): PostLinkView[] {
  return db.read(() => {
    return listPostLinks(db, postId).map((link) => {
      if (link.targetKind === "task") {
        const task = taskListItem(db, swarmId, link.targetId);
        return { ...link, title: task.title, status: task.waiting ? "waiting" : task.status };
      }
      const criterion = criterionListItem(db, swarmId, link.targetId);
      return { ...link, title: criterion.title, status: criterion.status };
    });
  });
}
