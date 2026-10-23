import type { PostClaim } from "../../../../src/api-types";
import { AgentName } from "../../components/AgentName";
import styles from "./Wall.module.css";

export function PostClaims({ claims = [] }: { claims?: readonly PostClaim[] }) {
  if (claims.length === 0) return null;
  return (
    <section className={styles.claims} aria-label="Claimed roles">
      <h2>Claimed roles</h2>
      <ul>
        {claims.map((claim) => (
          <li key={claim.role}>
            <strong>{claim.role}</strong>
            <AgentName name={claim.agent} />
          </li>
        ))}
      </ul>
    </section>
  );
}
