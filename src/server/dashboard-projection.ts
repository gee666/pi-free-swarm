import type {
  CriteriaCoverage,
  DashboardResponse,
  RunHeaderState,
  SwarmListItem,
  WorkActivityRow,
} from "../api-types.js";
import { workDashboard } from "../broker/work-queries.js";
import { WORK_ACTIVITY_LIMIT } from "../constants.js";
import { listCriteria, criterionVotes, getBlocker } from "../store/criteria.js";
import type { SwarmDb } from "../store/db.js";
import { getTask, listTasks } from "../store/tasks.js";
import { taskStates } from "../store/work-state.js";
import { userUnreadSummary } from "../store/user-unread.js";
import { criterionListItems } from "./work-projection.js";

function runState(swarm: SwarmListItem, work: ReturnType<typeof workDashboard>): RunHeaderState {
  if (swarm.status === "interrupted") return "interrupted";
  if (swarm.status === "stopped") return "stopped";
  if (swarm.status === "finished") return work.project.outcome ?? "stopped";
  return work.completion.awaitingUser ? "awaiting_user" : "running";
}
function activity(db: SwarmDb, swarmId: number, work: ReturnType<typeof workDashboard>): WorkActivityRow[] {
  const rows: WorkActivityRow[] = work.recentActivity.map((event) => ({
    id: `task-event:${event.id}`,
    actor: event.actor,
    kind: event.kind,
    targetKind: "task",
    targetId: event.taskId,
    title: getTask(db, swarmId, event.taskId)?.title ?? `Task #${event.taskId}`,
    createdAt: event.createdAt,
  }));
  for (const criterion of listCriteria(db, swarmId, true)) {
    const target: Pick<WorkActivityRow, "targetKind" | "targetId" | "title"> = {
      targetKind: "criterion",
      targetId: criterion.id,
      title: criterion.title,
    };
    rows.push({
      ...target,
      id: `criterion:${criterion.id}`,
      actor: criterion.author,
      kind: "criterion_created",
      createdAt: criterion.createdAt,
    });
    for (const vote of criterionVotes(db, criterion.id))
      rows.push({
        ...target,
        id: `criterion-vote:${criterion.id}:${vote.voter}`,
        actor: vote.voter,
        kind: `vote_${vote.verdict}`,
        createdAt: vote.createdAt,
      });
    const blocker = getBlocker(db, criterion.id);
    if (blocker) {
      rows.push({
        ...target,
        id: `criterion-blocker:${criterion.id}`,
        actor: blocker.author,
        kind: "blocker_updated",
        createdAt: blocker.updatedAt,
      });
      if (blocker.decidedAt !== null)
        rows.push({
          ...target,
          id: `blocker-decision:${criterion.id}`,
          actor: "User",
          kind: blocker.approvedRevision === blocker.revision ? "blocker_approved" : "blocker_rejected",
          createdAt: blocker.decidedAt,
        });
    }
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).slice(0, WORK_ACTIVITY_LIMIT);
}
export function dashboard(db: SwarmDb, swarm: SwarmListItem, now: number): DashboardResponse {
  const work = workDashboard(db, swarm.id, now);
  const criteria = criterionListItems(db, swarm.id);
  const tasks = listTasks(db, swarm.id);
  const states = taskStates(db, swarm.id);
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
  return {
    project: work.project,
    completion: work.completion,
    gates: work.completion.gates,
    counts: {
      ...work.counts,
      satisfied: criteria.filter((item) => item.status === "satisfied").length,
      blocked: criteria.filter((item) => item.status === "blocked").length,
      incomplete: criteria.filter((item) => item.status === "incomplete").length,
      inProgress: tasks.filter((item) => item.status === "in_progress").length,
      inReview: tasks.filter((item) => item.status === "review").length,
      waiting: states.filter((item) => item.waiting).length,
      runnable: states.filter((item) => item.runnable).length,
      deferred: states.filter((item) => item.deferred).length,
    },
    velocity: work.velocity,
    etaMs: work.velocity.etaMs,
    header: {
      state: runState(swarm, work),
      run: swarm.runCount,
      agentCount: swarm.agentAmount,
      startedAt: swarm.startedAt,
    },
    criteriaCoverage: [...groups.values()].sort((a, b) => a.group.localeCompare(b.group)),
    recentActivity: activity(db, swarm.id, work),
    attention: {
      scopeApprovalNeeded: work.project.scopeApprovedRevision !== work.project.scopeRevision,
      blockerDecisions: criteria.filter((criterion) => criterion.exceptionPending),
      unreadUserMessages: userUnreadSummary(db, swarm.id).messages,
      unlinkedCriteria: criteria.filter((criterion) => criterion.status === "unlinked"),
    },
    queue: work.queue,
    runnable: work.runnable,
  };
}
