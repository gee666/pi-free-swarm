export type AcceptanceVoteVerdict = "accepted" | "incomplete" | "blocked";
export type AcceptanceVerdict = "unchecked" | AcceptanceVoteVerdict;

export interface AcceptanceVote {
  agent: string;
  run: number;
  verdict: AcceptanceVoteVerdict;
  reason: string;
  updatedAt: number;
}

export interface AcceptanceHistoryPage {
  votes: AcceptanceVote[];
  next: string | null;
  complete: boolean;
  /** Retired rows inspected, including workers that never submitted a vote. */
  scanned: number;
}

export interface AcceptanceRecord {
  swarmId: number;
  originalTask: string;
  acceptanceCriteria: string[];
  revision: number;
  verdict: AcceptanceVerdict;
  votes: AcceptanceVote[];
  /** Historical judgments of retired workers, never included in the tally. */
  excludedVotes?: AcceptanceVote[];
  counts: Record<AcceptanceVoteVerdict, number>;
  threshold: number;
  totalAgents: number;
  updatedBy: string | null;
  updatedAt: number | null;
}
