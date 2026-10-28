import { existsSync } from "node:fs";
import path from "node:path";
import type { TaskRecord } from "../api-work-types.js";
import { REVIEW_CONTEXT_MAX, REVIEWS_DIR, SESSIONS_DIR, SESSION_FILE, USER_NAME } from "../constants.js";
import { charCount } from "../limits.js";
import type { SwarmDb } from "../store/db.js";
import { isPidAlive, type PidAlive } from "../store/locks.js";
import { getCriterion } from "../store/criteria.js";
import { listTasks, taskLinks } from "../store/tasks.js";
import { BrokerError } from "./errors.js";
import { commitTask, dependencyNotifications, requireStatus } from "./task-write.js";
import { fullWorkText } from "./work-text.js";
import { requireTask, type WorkInput } from "./work-validation.js";
import { writeWork } from "./work-write.js";

export type ReviewVerdict = "accept" | "changes";
export interface ReviewInput extends WorkInput {
  id: number;
  context: string;
  resume?: boolean;
}
export function reviewSessionFile(db: SwarmDb, swarmId: number, taskId: number): string {
  return path.join(db.dataDir, SESSIONS_DIR, String(swarmId), REVIEWS_DIR, `task-${taskId}`, SESSION_FILE);
}
export function beginTaskReview(db: SwarmDb, input: ReviewInput) {
  return writeWork(db, input, (actor) => {
    const task = requireTask(db, input.swarmId, input.id);
    if (task.owner !== actor || actor === USER_NAME)
      throw new BrokerError("validation", "Only the task owner may call swarm_review.");
    requireStatus(task, "in_progress");
    const context = input.context.trim();
    if (!context || charCount(input.context) > REVIEW_CONTEXT_MAX)
      throw new BrokerError("validation", `context is required and must be at most ${REVIEW_CONTEXT_MAX} characters.`);
    const sessionFile = reviewSessionFile(db, input.swarmId, task.id);
    const previous = db.sql.prepare("SELECT verdict FROM task_reviews WHERE task_id = ?").get(task.id);
    if (input.resume && (previous?.verdict !== "changes" || !existsSync(sessionFile)))
      throw new BrokerError("validation", "resume requires a previous changes review and its session file.");
    const updated = commitTask(db, input, { ...task, status: "review" }, actor, "review_requested", "", context);
    db.sql
      .prepare(
        `INSERT INTO task_reviews(task_id, revision, owner_pid) VALUES (?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET revision = excluded.revision, owner_pid = excluded.owner_pid,
      reviewer_pid = NULL, verdict = NULL`,
      )
      .run(task.id, updated.revision, process.pid);
    const criteria = taskLinks(db, task.id).map((link) => {
      const criterion = getCriterion(db, input.swarmId, link.criterionId);
      if (!criterion) throw new Error(`Missing criterion #${link.criterionId}.`);
      return {
        ...criterion,
        body: fullWorkText(db, criterion.body),
        verification: fullWorkText(db, criterion.verification),
        source: fullWorkText(db, criterion.source),
        contribution: fullWorkText(db, link.contribution),
      };
    });
    return {
      task: updated,
      sessionFile,
      prompt: JSON.stringify({
        task: { id: task.id, title: task.title, body: fullWorkText(db, task.body) },
        criteria,
        context,
      }),
    };
  });
}
export function attachReviewer(db: SwarmDb, taskId: number, revision: number, pid: number): void {
  db.write(() => {
    db.sql
      .prepare("UPDATE task_reviews SET reviewer_pid = ? WHERE task_id = ? AND revision = ?")
      .run(pid, taskId, revision);
  });
}
export function finishTaskReview(
  db: SwarmDb,
  input: WorkInput & { id: number; revision: number; verdict: ReviewVerdict | null; reason: string },
): TaskRecord {
  return writeWork(db, input, (actor) => {
    const task = requireTask(db, input.swarmId, input.id);
    const review = db.sql.prepare("SELECT revision FROM task_reviews WHERE task_id = ?").get(task.id);
    if (review?.revision !== input.revision) return task;
    db.sql
      .prepare("UPDATE task_reviews SET owner_pid = NULL, reviewer_pid = NULL, verdict = ? WHERE task_id = ?")
      .run(input.verdict, task.id);
    if (task.status !== "review") return task;
    const unchanged = task.revision === input.revision && task.owner === actor;
    const accepted = unchanged && input.verdict === "accept";
    const updated = commitTask(
      db,
      input,
      {
        ...task,
        status: accepted ? "accepted" : "in_progress",
        acceptedAt: accepted ? input.now : null,
        acceptedBy: accepted ? `${actor} review` : null,
      },
      actor,
      accepted ? "review_accepted" : "changes_requested",
      unchanged ? input.reason : `Task changed during review. Review again.\n${input.reason}`,
    );
    dependencyNotifications(db, input, updated, actor, false);
    return updated;
  });
}
export function resetOrphanedReviews(db: SwarmDb, swarmId: number, now: number, alive: PidAlive = isPidAlive): void {
  writeWork(db, { swarmId, actor: USER_NAME, now }, () => {
    for (const task of listTasks(db, swarmId).filter((task) => task.status === "review")) {
      const review = db.sql.prepare("SELECT owner_pid, reviewer_pid FROM task_reviews WHERE task_id = ?").get(task.id);
      const pid = review?.reviewer_pid ?? review?.owner_pid;
      if (typeof pid === "number" && alive(pid)) continue;
      commitTask(
        db,
        { swarmId, actor: USER_NAME, now },
        { ...task, status: "in_progress" },
        USER_NAME,
        "changes_requested",
        "Review interrupted: no live reviewer. Call swarm_review again.",
      );
      db.sql
        .prepare("UPDATE task_reviews SET owner_pid = NULL, reviewer_pid = NULL, verdict = NULL WHERE task_id = ?")
        .run(task.id);
    }
  });
}
