import { useRef, useState } from "react";
import { Popover } from "./Popover";
import type { SwarmDetailResponse } from "../../../src/api-types";
import styles from "./AcceptanceSummary.module.css";
import { AgentName } from "./AgentName";
import { ArchivedVotes } from "./ArchivedVotes";

export function AcceptanceSummary({ detail }: { detail: SwarmDetailResponse }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const record = detail.acceptance;
  if (!record) return null;
  return (
    <>
      <button
        ref={anchor}
        className={styles.pill}
        aria-expanded={open}
        aria-label={`Task acceptance: ${record.verdict}`}
        onClick={() => setOpen(!open)}
      >
        verdict: {record.verdict}
      </button>
      <Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)} align="end" className={styles.summary}>
        <p>
          Execution: {detail.swarm.status} · Task verdict: {record.verdict}
          {record.verdict === "accepted" && " (agent-attested)"}
        </p>
        <p>Agent votes against the original task, not independent verification.</p>
        <p>Original task: {record.originalTask}</p>
        <h3>Acceptance criteria</h3>
        <ul>
          {record.acceptanceCriteria.map((criterion, index) => (
            <li key={index}>{criterion}</li>
          ))}
        </ul>
        <p>
          Revision {record.revision} · Updated by {record.updatedBy ? <AgentName name={record.updatedBy} /> : "nobody"}
        </p>
        <p>
          Quorum: {record.threshold} of {record.totalAgents} agents
        </p>
        <p>
          Accepted: {record.counts.accepted} · Incomplete: {record.counts.incomplete} · Blocked: {record.counts.blocked}
        </p>
        <h3>Votes</h3>
        {record.votes.length === 0 ? (
          <p>No votes recorded.</p>
        ) : (
          <ul>
            {record.votes.map((vote) => (
              <li key={vote.agent}>
                <AgentName name={vote.agent} />: {vote.verdict}
                <p>{vote.reason}</p>
              </li>
            ))}
          </ul>
        )}
        <ArchivedVotes key={record.swarmId} swarmId={record.swarmId} />
      </Popover>
    </>
  );
}
