import { useEffect, useRef, useState } from "react";
import type { CriterionDetailResponse, CriterionVoteView, VoteVerdict } from "../../../../src/api-types";
import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { RichText } from "../../components/RichText";
import { Section } from "../../components/Section";
import { SegmentedControl } from "../../components/SegmentedControl";
import { ErrorBanner } from "../../components/States";
import { cx } from "../../lib/cx";
import { LongField } from "../work-items/WorkFields";
import { useWorkMutation } from "../work-items/useWorkMutation";
import styles from "../work-items/WorkItems.module.css";

function VoteRow({ vote }: { vote: CriterionVoteView }) {
  const [expanded, setExpanded] = useState(false);
  const verdict = vote.verdict === "covered" ? "Covered" : vote.verdict === "blocked" ? "Blocked" : "Gap";
  return (
    <div className={vote.stale ? styles.stale : undefined}>
      <button
        className={cx(styles.compactRow, styles.voteRow)}
        aria-expanded={expanded}
        aria-label={`${vote.voter} ${vote.role} ${verdict}: ${vote.reason}${vote.stale ? " · stale" : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        <Avatar name={vote.voter} size="sm" />
        <span>{vote.voter}</span>
        <span className={styles.muted}>{vote.role}</span>
        <span className={vote.verdict === "covered" ? styles.pink : undefined}>{verdict}</span>
        <span className={cx(styles.ellipsis, styles.muted)}>{vote.reason}</span>
        {vote.stale && <span className={styles.muted}>stale</span>}
      </button>
      {expanded && (
        <div className={styles.voteReason}>
          <RichText text={vote.reason} />
        </div>
      )}
    </div>
  );
}

function missingVoters(detail: CriterionDetailResponse) {
  const owners = detail.missingVoters.filter((name) => detail.requiredOwners.includes(name));
  const independent = detail.missingVoters.filter((name) => !detail.requiredOwners.includes(name));
  const names = new Intl.ListFormat("en", { style: "long", type: "conjunction" });
  return names.format([
    ...(owners.length ? [`${names.format(owners)} (${owners.length === 1 ? "owner" : "owners"})`] : []),
    ...independent.map((name) => (name === "independent" ? "one independent voter" : `${name} (independent)`)),
  ]);
}

export function CriterionVotes({
  swarmId,
  detail,
  open,
  onClose,
  onChanged,
}: {
  swarmId: string;
  detail: CriterionDetailResponse;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [verdict, setVerdict] = useState<VoteVerdict>();
  const [reason, setReason] = useState("");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (open) form.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);
  const mutation = useWorkMutation(swarmId, () => {
    onClose();
    onChanged();
  });
  const blockedReason = !detail.blocker
    ? "Record a blocker first"
    : detail.blocker.rejectedRevision === detail.blocker.revision
      ? "Revise the rejected blocker before voting blocked"
      : undefined;
  const disabled = verdict === "blocked" && blockedReason !== undefined;
  return (
    <Section title="Votes">
      {open && (
        <form
          ref={form}
          className={styles.voteForm}
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
              { value: "blocked", label: "Blocked", disabledReason: blockedReason },
            ]}
          />
          <LongField
            label={verdict === "gap" ? "Reason: what is missing?" : "Reason"}
            value={reason}
            onChange={setReason}
          />
          <div className={styles.actions}>
            <Button variant="primary" type="submit" disabled={mutation.busy || disabled || !verdict || !reason.trim()}>
              Submit vote
            </Button>
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </form>
      )}
      {detail.votes.length === 0 && <p className={styles.muted}>No votes yet</p>}
      {detail.votes.length > 0 && (
        <div>
          {detail.votes.map((vote) => (
            <VoteRow key={vote.voter} vote={vote} />
          ))}
        </div>
      )}
      {detail.missingVoters.length > 0 && <p className={styles.muted}>Waiting for {missingVoters(detail)}</p>}
    </Section>
  );
}
