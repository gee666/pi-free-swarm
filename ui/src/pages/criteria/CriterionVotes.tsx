import { useState } from "react";
import type { CriterionDetailResponse, VoteVerdict } from "../../../../src/api-types";
import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { Pill } from "../../components/Pill";
import { RichText } from "../../components/RichText";
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
  const [verdict, setVerdict] = useState<VoteVerdict>();
  const [reason, setReason] = useState("");
  const mutation = useWorkMutation(swarmId, onChanged);
  const blockedReason = !detail.blocker
    ? "Record a blocker first"
    : detail.blocker.rejectedRevision === detail.blocker.revision
      ? "Revise the rejected blocker before voting blocked"
      : undefined;
  const disabled = verdict === "blocked" && blockedReason !== undefined;
  return (
    <Section title="Votes">
      {detail.votes.map((vote) => (
        <div className={styles.entry} key={vote.voter}>
          <div className={styles.line}>
            <Avatar name={vote.voter} size="sm" />
            <span>{vote.voter}</span>
            <Pill>{vote.role}</Pill>
            <span className={vote.verdict === "covered" ? styles.pink : undefined}>
              {vote.verdict === "covered" ? "Covered" : vote.verdict === "blocked" ? "Blocked" : "Gap"}
            </span>
            {vote.stale && <span className={styles.stale}>stale</span>}
          </div>
          <RichText text={vote.reason} />
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
          if (!verdict || disabled || !reason.trim() || mutation.busy) return;
          void mutation.mutate(`criteria/${detail.id}/vote`, { expectedRevision: detail.revision, verdict, reason });
        }}
      >
        <h3>Your vote</h3>
        <p className={styles.muted}>Do the linked tasks, when done, fully satisfy this criterion?</p>
        {mutation.error && <ErrorBanner>{mutation.error.message}</ErrorBanner>}
        <SegmentedControl<VoteVerdict>
          label="Your vote"
          value={verdict}
          onChange={setVerdict}
          options={[
            { value: "covered", label: "Covered" },
            { value: "gap", label: "Gap" },
            {
              value: "blocked",
              label: "Blocked",
              disabledReason: blockedReason,
            },
          ]}
        />
        <LongField
          label={verdict === "gap" ? "Reason: what is missing?" : "Reason"}
          value={reason}
          onChange={setReason}
        />
        <Button variant="primary" type="submit" disabled={mutation.busy || disabled || !verdict || !reason.trim()}>
          Vote
        </Button>
      </form>
    </Section>
  );
}
