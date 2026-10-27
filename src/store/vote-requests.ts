import type { SwarmDb } from "./db.js";
import { text } from "./rows.js";

export type VoteRequestPhase = "coverage" | "accepted";
export interface VoteRequestState {
  id: number;
  revision: number;
  linksSignature: string;
}
export function requestedVoters(db: SwarmDb, state: VoteRequestState, phase: VoteRequestPhase): string[] {
  return db.sql
    .prepare(
      `SELECT voter FROM criterion_vote_requests
      WHERE criterion_id = ? AND criterion_revision = ? AND links_signature = ? AND phase = ?`,
    )
    .all(state.id, state.revision, state.linksSignature, phase)
    .map((row) => text(row, "voter"));
}
export function recordVoteRequest(db: SwarmDb, state: VoteRequestState, phase: VoteRequestPhase, voter: string): void {
  db.sql
    .prepare(
      `INSERT OR IGNORE INTO criterion_vote_requests
      (criterion_id, criterion_revision, links_signature, phase, voter) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(state.id, state.revision, state.linksSignature, phase, voter);
}
