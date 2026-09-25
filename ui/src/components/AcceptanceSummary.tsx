import type { SwarmDetailResponse } from "../../../src/api-types";
import styles from "./AcceptanceSummary.module.css";

export function AcceptanceSummary({ detail }: { detail: SwarmDetailResponse }) {
  const record = detail.acceptance;
  if (!record) return null;
  return (
    <details className={styles.summary} aria-label="Task acceptance">
      <summary>
        Execution: {detail.swarm.status} · Task verdict: {record.verdict}
        {record.verdict === "accepted" && " (agent-attested)"}
      </summary>
      <p>
        Agent attestation against the original task, not independent verification. Later edits are not detected
        automatically.
      </p>
      <p>Original task: {record.originalTask}</p>
      <p>
        Revision {record.revision} · Updated by {record.updatedBy ?? "nobody"}
        {record.claimant && ` · Checking: ${record.claimant}`}
      </p>
      <h3>Evidence</h3>
      {record.evidence.length === 0 ? (
        <p>No evidence recorded.</p>
      ) : (
        <ul>
          {record.evidence.map((item, index) => (
            <li key={index}>
              <p>
                {item.reference}: {item.result}
              </p>
              {item.command && (
                <pre>
                  {item.command}
                  {"\n"}cwd: {item.cwd}
                </pre>
              )}
              {item.fingerprint && <p>Supplied fingerprint (not verified): {item.fingerprint}</p>}
            </li>
          ))}
        </ul>
      )}
      <h3>Known gaps</h3>
      {record.knownGaps.length === 0 ? (
        <p>None recorded.</p>
      ) : (
        <ul>
          {record.knownGaps.map((gap, index) => (
            <li key={index}>{gap}</li>
          ))}
        </ul>
      )}
      <h3>Findings</h3>
      {record.findings.length === 0 ? (
        <p>None recorded.</p>
      ) : (
        <ul>
          {record.findings.map((finding, index) => (
            <li key={index}>{finding}</li>
          ))}
        </ul>
      )}
    </details>
  );
}
