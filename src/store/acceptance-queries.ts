import { Type } from "typebox";
import { Value } from "typebox/value";
import { WATCHER_NAME } from "../constants.js";
import type { AcceptanceRecord, AcceptanceVote, AcceptanceVoteVerdict } from "./acceptance-types.js";
import type { SwarmDb } from "./db.js";
import { int, intOrNull, text, textOrNull, type Row } from "./rows.js";

const criteriaSchema = Type.Array(Type.String());
const voteVerdicts: readonly AcceptanceVoteVerdict[] = ["accepted", "incomplete", "blocked"];

export function acceptanceVoteOf(row: Row): AcceptanceVote {
  const verdict = voteVerdicts.find((candidate) => candidate === row.verdict);
  if (!verdict) throw new Error("Invalid acceptance vote verdict");
  return {
    agent: text(row, "agent"),
    run: int(row, "run"),
    verdict,
    reason: text(row, "reason"),
    updatedAt: int(row, "vote_updated_at"),
  };
}

export interface AcceptanceReadOptions {
  includeExcludedVotes?: boolean;
}

export function getAcceptance(db: SwarmDb, swarmId: number, options: AcceptanceReadOptions = {}): AcceptanceRecord {
  // One statement keeps revision, electorate and votes in the same SQLite read snapshot.
  const rows = db.sql
    .prepare(
      `SELECT a.*, s.task_prompt, s.acceptance_criteria,
      (SELECT count(*) FROM participants WHERE swarm_id = s.id AND kind = 'agent' AND name != ? AND retired_at IS NULL) AS total_agents,
      v.agent, v.run, v.verdict, v.reason, v.updated_at AS vote_updated_at, p.retired_at AS voter_retired_at
      FROM acceptance a JOIN swarms s ON s.id = a.swarm_id
      LEFT JOIN participants p ON p.swarm_id = s.id AND p.kind = 'agent' AND p.name != ?
        ${options.includeExcludedVotes ? "" : "AND p.retired_at IS NULL"}
      LEFT JOIN acceptance_votes v ON v.swarm_id = p.swarm_id AND v.agent = p.name
        AND (${options.includeExcludedVotes ? "p.retired_at IS NOT NULL OR " : ""}v.run = s.run_count)
      WHERE a.swarm_id = ? ORDER BY p.launch_order, p.name`,
    )
    .all(WATCHER_NAME, WATCHER_NAME, swarmId);
  const row = rows[0];
  if (!row) throw new Error(`Acceptance record for swarm #${swarmId} not found`);
  const acceptanceCriteria: unknown = JSON.parse(text(row, "acceptance_criteria"));
  if (!Value.Check(criteriaSchema, acceptanceCriteria)) throw new Error("Invalid acceptance criteria");
  const votes = rows.filter((vote) => vote.agent !== null && vote.voter_retired_at === null).map(acceptanceVoteOf);
  const excludedVotes = rows
    .filter((vote) => vote.agent !== null && vote.voter_retired_at !== null)
    .map(acceptanceVoteOf);
  const totalAgents = int(row, "total_agents");
  const threshold = Math.ceil((totalAgents * 70) / 100);
  const counts = { accepted: 0, incomplete: 0, blocked: 0 };
  for (const vote of votes) counts[vote.verdict]++;
  const verdict =
    threshold > 0 && counts.accepted >= threshold
      ? "accepted"
      : threshold > 0 && counts.blocked >= threshold
        ? "blocked"
        : votes.length > 0
          ? "incomplete"
          : "unchecked";
  return {
    swarmId,
    originalTask: text(row, "task_prompt"),
    acceptanceCriteria,
    revision: int(row, "revision"),
    verdict,
    votes,
    ...(excludedVotes.length > 0 ? { excludedVotes } : {}),
    counts,
    threshold,
    totalAgents,
    updatedBy: textOrNull(row, "updated_by"),
    updatedAt: intOrNull(row, "updated_at"),
  };
}

export function saveAcceptance(
  db: SwarmDb,
  record: Pick<AcceptanceRecord, "swarmId" | "revision" | "updatedBy" | "updatedAt">,
): void {
  db.sql
    .prepare("UPDATE acceptance SET revision = ?, updated_by = ?, updated_at = ? WHERE swarm_id = ?")
    .run(record.revision, record.updatedBy, record.updatedAt, record.swarmId);
}
