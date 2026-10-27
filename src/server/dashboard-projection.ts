import type { DashboardResponse, RunHeaderState, SwarmListItem } from "../api-types.js";
import { workDashboard } from "../broker/work-queries.js";
import type { SwarmDb } from "../store/db.js";
import { listTasks } from "../store/tasks.js";
import { taskStates } from "../store/work-state.js";
import { userUnreadSummary } from "../store/user-unread.js";
import { criteriaCoverage, criterionListItems } from "./work-projection.js";

function runState(swarm: SwarmListItem, work: ReturnType<typeof workDashboard>): RunHeaderState {
  if (swarm.status === "interrupted") return "interrupted";
  if (swarm.status === "stopped") return "stopped";
  if (swarm.status === "finished") return work.project.outcome ?? "stopped";
  return "running";
}
export function dashboard(db: SwarmDb, swarm: SwarmListItem, now: number): DashboardResponse {
  const work = workDashboard(db, swarm.id, now);
  const criteria = criterionListItems(db, swarm.id);
  const tasks = listTasks(db, swarm.id);
  const states = taskStates(db, swarm.id);
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
    criteriaCoverage: criteriaCoverage(criteria),
    recentActivity: work.recentActivity,
    attention: {
      agreedBlockers: criteria.filter((criterion) => criterion.status === "blocked"),
      unreadUserMessages: userUnreadSummary(db, swarm.id).messages,
    },
    queue: work.queue,
    runnable: work.runnable,
  };
}
