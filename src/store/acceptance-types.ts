export type AcceptanceVoteVerdict = "accepted" | "incomplete" | "blocked";
export type AcceptanceVerdict = "unchecked" | AcceptanceVoteVerdict;

export interface AcceptanceVote {
  agent: string;
  run: number;
  verdict: AcceptanceVoteVerdict;
  reason: string;
  updatedAt: number;
}

export interface AcceptanceRecord {
  swarmId: number;
  originalTask: string;
  acceptanceCriteria: string[];
  revision: number;
  verdict: AcceptanceVerdict;
  votes: AcceptanceVote[];
  counts: Record<AcceptanceVoteVerdict, number>;
  threshold: number;
  totalAgents: number;
  updatedBy: string | null;
  updatedAt: number | null;
}
