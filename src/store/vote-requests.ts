import type { SwarmDb } from "./db.js";
import { text } from "./rows.js";

export interface VoteRequestState {
  id: number;
  revision: number;
  linksSignature: string;
}
export function requestedVoters(db: SwarmDb, state: VoteRequestState): string[] {
  return db.sql
    .prepare(
      `SELECT voter FROM criterion_vote_requests
      WHERE criterion_id = ? AND links_signature = ? AND phase = 'accepted'`,
    )
    .all(state.id, state.linksSignature)
    .map((row) => text(row, "voter"));
}
export function recordVoteRequest(db: SwarmDb, state: VoteRequestState, voter: string): void {
  db.sql
    .prepare(
      `INSERT OR IGNORE INTO criterion_vote_requests
      (criterion_id, criterion_revision, links_signature, phase, voter) VALUES (?, ?, ?, 'accepted', ?)`,
    )
    .run(state.id, state.revision, state.linksSignature, voter);
}
