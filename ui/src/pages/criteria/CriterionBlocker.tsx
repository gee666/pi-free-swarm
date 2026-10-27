import { useRef, useState } from "react";
import type { CriterionDetailResponse } from "../../../../src/api-types";
import { Button } from "../../components/Button";
import { Popover } from "../../components/Popover";
import { RichText } from "../../components/RichText";
import { Section } from "../../components/Section";
import { ErrorBanner } from "../../components/States";
import { LongField } from "../work-items/WorkFields";
import { useWorkMutation } from "../work-items/useWorkMutation";
import styles from "../work-items/WorkItems.module.css";

export function CriterionBlocker({
  swarmId,
  detail,
  onChanged,
}: {
  swarmId: string;
  detail: CriterionDetailResponse;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"approve" | "reject">();
  const anchor = useRef<HTMLButtonElement>(null);
  const blocker = detail.blocker;
  const [fields, setFields] = useState({
    reason: blocker?.reason ?? "",
    missing: blocker?.missing ?? "",
    attempted: blocker?.attempted ?? "",
    unblock: blocker?.unblock ?? "",
  });
  const mutation = useWorkMutation(swarmId, () => {
    setEditing(false);
    setConfirm(undefined);
    onChanged();
  });
  const decide = (decision: "approve" | "reject") =>
    void mutation.mutate(`criteria/${detail.id}/blocker-decision`, {
      expectedRevision: blocker?.revision ?? 0,
      decision,
    });
  return (
    <Section
      title="Blocker"
      action={
        <Button size="sm" onClick={() => setEditing(!editing)}>
          {blocker ? "Edit blocker" : "Record blocker"}
        </Button>
      }
    >
      {mutation.error && <ErrorBanner>{mutation.error.message}</ErrorBanner>}
      {editing ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void mutation.mutate(`criteria/${detail.id}/block`, {
              ...fields,
              expectedRevision: blocker?.revision ?? 0,
            });
          }}
        >
          {(["reason", "missing", "attempted", "unblock"] satisfies (keyof typeof fields)[]).map((key) => (
            <LongField
              key={key}
              label={key === "unblock" ? "Would unblock" : key[0].toUpperCase() + key.slice(1)}
              value={fields[key]}
              onChange={(value) => setFields((current) => ({ ...current, [key]: value }))}
            />
          ))}
          <div className={styles.actions}>
            <Button
              type="submit"
              variant="primary"
              disabled={mutation.busy || Object.values(fields).some((value) => !value.trim())}
            >
              Save
            </Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        blocker && (
          <>
            {[
              ["Reason", blocker.reason],
              ["Missing", blocker.missing],
              ["Attempted", blocker.attempted],
              ["Would unblock", blocker.unblock],
            ].map(([label, text]) => (
              <div className={styles.entry} key={label}>
                <span className={styles.muted}>{label}</span>
                <RichText text={text} />
              </div>
            ))}
            <p className={styles.muted}>
              {detail.agreement.current}/{detail.agreement.required} agreed
            </p>
            {detail.exceptionPending ? (
              <div className={styles.actions}>
                <Button ref={anchor} variant="primary" onClick={() => setConfirm("approve")}>
                  Accept exception
                </Button>
                <Button onClick={() => setConfirm("reject")}>Reject</Button>
                <Popover anchorRef={anchor} open={confirm !== undefined} onClose={() => setConfirm(undefined)}>
                  <div className={styles.form}>
                    <p>{confirm === "approve" ? "Accept exception?" : "Reject exception?"}</p>
                    <Button variant="primary" disabled={mutation.busy} onClick={() => confirm && decide(confirm)}>
                      Confirm
                    </Button>
                    <Button onClick={() => setConfirm(undefined)}>Cancel</Button>
                  </div>
                </Popover>
              </div>
            ) : (
              detail.decision && (
                <p>
                  {detail.decision === "approved"
                    ? "Exception accepted"
                    : detail.decision === "rejected"
                      ? "Exception rejected"
                      : "Awaiting agreement"}
                </p>
              )
            )}
          </>
        )
      )}
    </Section>
  );
}
