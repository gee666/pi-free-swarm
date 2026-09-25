import { Value } from "typebox/value";
import { AcceptancePayload, type AcceptanceRecord, type AcceptanceVerdict } from "./acceptance-types.js";
import type { SwarmDb } from "./db.js";
import { int, intOrNull, text, textOrNull } from "./rows.js";

const verdicts: readonly AcceptanceVerdict[] = ["unchecked", "checking", "accepted", "incomplete", "blocked"];

export function getAcceptance(db: SwarmDb, swarmId: number): AcceptanceRecord {
  const row = db.sql
    .prepare(
      `SELECT a.*, s.task_prompt FROM acceptance a
    JOIN swarms s ON s.id = a.swarm_id WHERE a.swarm_id = ?`,
    )
    .get(swarmId);
  if (!row) throw new Error(`Acceptance record for swarm #${swarmId} not found`);
  const verdict = verdicts.find((candidate) => candidate === row.verdict);
  if (!verdict) throw new Error("Invalid acceptance verdict");
  const payload: unknown = {
    evidence: JSON.parse(text(row, "evidence")),
    knownGaps: JSON.parse(text(row, "known_gaps")),
    findings: JSON.parse(text(row, "findings")),
  };
  if (!Value.Check(AcceptancePayload, payload)) throw new Error("Invalid acceptance payload");
  return {
    ...payload,
    swarmId,
    originalTask: text(row, "task_prompt"),
    revision: int(row, "revision"),
    verdict,
    claimant: textOrNull(row, "claimant"),
    claimRun: intOrNull(row, "claim_run"),
    updatedBy: textOrNull(row, "updated_by"),
    updatedAt: intOrNull(row, "updated_at"),
  };
}

export function saveAcceptance(db: SwarmDb, record: AcceptanceRecord): void {
  db.sql
    .prepare(
      `UPDATE acceptance SET revision = ?, verdict = ?, claimant = ?, claim_run = ?,
    evidence = ?, known_gaps = ?, findings = ?, updated_by = ?, updated_at = ? WHERE swarm_id = ?`,
    )
    .run(
      record.revision,
      record.verdict,
      record.claimant,
      record.claimRun,
      JSON.stringify(record.evidence),
      JSON.stringify(record.knownGaps),
      JSON.stringify(record.findings),
      record.updatedBy,
      record.updatedAt,
      record.swarmId,
    );
}
