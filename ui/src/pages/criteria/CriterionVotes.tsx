import { useState } from "react";
import type { CriterionDetailResponse, VoteVerdict } from "../../../../src/api-types";
import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { Pill } from "../../components/Pill";
import { Section } from "../../components/Section";
import { SegmentedControl } from "../../components/SegmentedControl";
import { ErrorBanner } from "../../components/States";
import { LongField } from "../work-items/WorkFields";
import { useWorkMutation } from "../work-items/useWorkMutation";
import styles from "../work-items/WorkItems.module.css";

export function CriterionVotes({
  swarmId,
  detail,
  onChanged,
}: {
  swarmId: string;
  detail: CriterionDetailResponse;
  onChanged: () => void;
}) {
  const [verdict, setVerdict] = useState<VoteVerdict>("incomplete");
  const [reason, setReason] = useState("");
  const mutation = useWorkMutation(swarmId, onChanged);
  const allAccepted = detail.tasks.length > 0 && detail.tasks.every((task) => task.status === "accepted");
  const disabled = (verdict === "satisfied" && !allAccepted) || (verdict === "blocked" && !detail.blocker);
  return (
    <Section title="Votes">
      {detail.votes.map((vote) => (
        <div className={styles.entry} key={vote.voter}>
          <div className={styles.line}>
            <Avatar name={vote.voter} size="sm" />
            <span>{vote.voter}</span>
            <Pill>{vote.role}</Pill>
            <span className={vote.verdict === "satisfied" ? styles.pink : undefined}>
              {vote.verdict === "satisfied" ? "Satisfied" : vote.verdict === "blocked" ? "Blocked" : "Incomplete"}
            </span>
            {vote.stale && <span className={styles.stale}>stale</span>}
          </div>
          <p>{vote.reason}</p>
        </div>
      ))}
      {detail.missingVoters.map((name) => (
        <p className={styles.muted} key={name}>
          Waiting for {name} ({detail.requiredOwners.includes(name) ? "owner" : "independent"})
        </p>
      ))}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void mutation.mutate(`criteria/${detail.id}/vote`, { expectedRevision: detail.revision, verdict, reason });
        }}
      >
        <h3>Your vote</h3>
        {mutation.error && <ErrorBanner>{mutation.error.message}</ErrorBanner>}
        <SegmentedControl<VoteVerdict>
          label="Your vote"
          value={verdict}
          onChange={setVerdict}
          options={[
            {
              value: "satisfied",
              label: "Satisfied",
              disabledReason: allAccepted ? undefined : "Linked tasks are not all accepted",
            },
            { value: "incomplete", label: "Incomplete" },
            {
              value: "blocked",
              label: "Blocked",
              disabledReason: detail.blocker ? undefined : "Record a blocker first",
            },
          ]}
        />
        <LongField label="Reason" value={reason} onChange={setReason} />
        <Button variant="primary" type="submit" disabled={mutation.busy || disabled || !reason.trim()}>
          Vote
        </Button>
      </form>
    </Section>
  );
}
