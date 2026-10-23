import type { AcceptanceRecord } from "../store/acceptance-types.js";

/** Only a successful worker vote is condensed; authoritative inspection stays unchanged. */
export function formatAgentVoteResult(record: AcceptanceRecord, agent: string): string {
  const vote = record.votes.find((item) => item.agent.toLowerCase() === agent.toLowerCase());
  if (vote === undefined) {
    throw new Error("Vote response omitted your record. Inspect current votes before changing anything.");
  }
  return JSON.stringify({
    swarmId: record.swarmId,
    revision: record.revision,
    verdict: record.verdict,
    vote: { agent: vote.agent, run: vote.run, verdict: vote.verdict, reason: vote.reason },
    counts: record.counts,
    threshold: record.threshold,
    totalAgents: record.totalAgents,
  });
}
