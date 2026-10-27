import type { CriterionBlocker, CriterionRecord, CriterionVote, TaskRecord } from "../api-work-types.js";
import type { SwarmDb } from "./db.js";
import { count } from "./rows.js";
import { blockerOf, criterionOf, taskOf, voteOf } from "./work-rows.js";

export type CriterionFields = Pick<CriterionRecord, "group" | "title" | "body" | "verification" | "source">;
export type BlockerFields = Pick<CriterionBlocker, "reason" | "missing" | "attempted" | "unblock">;

export function getCriterion(db: SwarmDb, swarmId: number, id: number): CriterionRecord | null {
  const row = db.sql.prepare("SELECT * FROM criteria WHERE swarm_id = ? AND id = ?").get(swarmId, id);
  return row ? criterionOf(row) : null;
}
export function listCriteria(db: SwarmDb, swarmId: number, includeArchived = false): CriterionRecord[] {
  return db.sql
    .prepare(
      `SELECT * FROM criteria WHERE swarm_id = ? ${includeArchived ? "" : "AND archived_at IS NULL"} ORDER BY id`,
    )
    .all(swarmId)
    .map(criterionOf);
}
export function criterionTasks(db: SwarmDb, id: number): TaskRecord[] {
  return db.sql
    .prepare("SELECT t.* FROM tasks t JOIN task_criteria l ON l.task_id = t.id WHERE l.criterion_id = ? ORDER BY t.id")
    .all(id)
    .map(taskOf);
}
export function criterionVotes(db: SwarmDb, id: number): CriterionVote[] {
  return db.sql.prepare("SELECT * FROM criterion_votes WHERE criterion_id = ? ORDER BY voter").all(id).map(voteOf);
}
export function getBlocker(db: SwarmDb, id: number): CriterionBlocker | null {
  const row = db.sql.prepare("SELECT * FROM criterion_blockers WHERE criterion_id = ?").get(id);
  return row ? blockerOf(row) : null;
}
export function insertCriterion(
  db: SwarmDb,
  swarmId: number,
  fields: CriterionFields,
  author: string,
  now: number,
): number {
  return count(
    db.sql
      .prepare(
        `INSERT INTO criteria(swarm_id, group_name, title, body, verification, source, author, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(swarmId, fields.group, fields.title, fields.body, fields.verification, fields.source, author, now, now)
      .lastInsertRowid,
  );
}
export function saveCriterion(db: SwarmDb, criterion: CriterionRecord): void {
  db.sql
    .prepare(
      `UPDATE criteria SET group_name = ?, title = ?, body = ?, verification = ?, source = ?, revision = ?,
    archived_at = ?, updated_at = ? WHERE id = ? AND swarm_id = ?`,
    )
    .run(
      criterion.group,
      criterion.title,
      criterion.body,
      criterion.verification,
      criterion.source,
      criterion.revision,
      criterion.archivedAt,
      criterion.updatedAt,
      criterion.id,
      criterion.swarmId,
    );
}
export function saveVote(db: SwarmDb, vote: CriterionVote): void {
  db.sql
    .prepare(
      `INSERT INTO criterion_votes(criterion_id, voter, verdict, reason, criterion_revision, links_signature, blocker_revision, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(criterion_id, voter) DO UPDATE SET verdict = excluded.verdict,
    reason = excluded.reason, criterion_revision = excluded.criterion_revision, links_signature = excluded.links_signature,
    blocker_revision = excluded.blocker_revision, created_at = excluded.created_at`,
    )
    .run(
      vote.criterionId,
      vote.voter,
      vote.verdict,
      vote.reason,
      vote.criterionRevision,
      vote.linksSignature,
      vote.blockerRevision,
      vote.createdAt,
    );
}
export function saveBlocker(db: SwarmDb, blocker: CriterionBlocker): void {
  db.sql
    .prepare(
      `INSERT INTO criterion_blockers(criterion_id, revision, reason, missing, attempted, unblock, author,
    updated_at, approved_revision, rejected_revision, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(criterion_id) DO UPDATE SET revision = excluded.revision, reason = excluded.reason,
    missing = excluded.missing, attempted = excluded.attempted, unblock = excluded.unblock, author = excluded.author,
    updated_at = excluded.updated_at, approved_revision = excluded.approved_revision, rejected_revision = excluded.rejected_revision,
    decided_at = excluded.decided_at`,
    )
    .run(
      blocker.criterionId,
      blocker.revision,
      blocker.reason,
      blocker.missing,
      blocker.attempted,
      blocker.unblock,
      blocker.author,
      blocker.updatedAt,
      blocker.approvedRevision,
      blocker.rejectedRevision,
      blocker.decidedAt,
    );
}
