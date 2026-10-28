import { Fragment, useEffect, useRef, useState } from "react";
import type { CriterionDetailResponse } from "../../../../src/api-types";
import { Button } from "../../components/Button";
import { Popover } from "../../components/Popover";
import { RichText } from "../../components/RichText";
import { Section } from "../../components/Section";
import { ErrorBanner } from "../../components/States";
import { LongField } from "../work-items/WorkFields";
import { useWorkMutation } from "../work-items/useWorkMutation";
import styles from "../work-items/WorkItems.module.css";
import blockerStyles from "./CriterionBlocker.module.css";

export function CriterionBlocker({
  swarmId,
  detail,
  onChanged,
  editing,
  onClose,
}: {
  swarmId: string;
  detail: CriterionDetailResponse;
  onChanged: () => void;
  editing: boolean;
  onClose: () => void;
}) {
  const section = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editing) section.current?.scrollIntoView?.({ block: "nearest" });
  }, [editing]);
  const [confirm, setConfirm] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const blocker = detail.blocker;
  const [fields, setFields] = useState({
    reason: blocker?.reason ?? "",
    missing: blocker?.missing ?? "",
    attempted: blocker?.attempted ?? "",
    unblock: blocker?.unblock ?? "",
  });
  const mutation = useWorkMutation(swarmId, () => {
    onClose();
    setConfirm(false);
    onChanged();
  });
  const reject = () =>
    void mutation.mutate(`criteria/${detail.id}/blocker-decision`, {
      expectedRevision: blocker?.revision ?? 0,
      decision: "reject",
    });
  if (!blocker && !editing) return null;
  return (
    <div ref={section}>
      <Section title="Blocker">
        {mutation.error && <ErrorBanner>{mutation.error.message}</ErrorBanner>}
        {editing ? (
          <form
            className={styles.voteForm}
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
              <Button onClick={onClose}>Cancel</Button>
            </div>
          </form>
        ) : (
          blocker && (
            <>
              <dl className={blockerStyles.fields}>
                {[
                  ["Reason", blocker.reason],
                  ["Missing", blocker.missing],
                  ["Attempted", blocker.attempted],
                  ["Would unblock", blocker.unblock],
                ].map(([label, text]) => (
                  <Fragment key={label}>
                    <dt>{label}</dt>
                    <dd>
                      <RichText text={text} />
                    </dd>
                  </Fragment>
                ))}
              </dl>
              <div className={blockerStyles.decision}>
                <p className={styles.muted}>
                  {detail.status === "blocked"
                    ? "Agreed by all voters"
                    : `${detail.agreement.current}/${detail.agreement.required} agreed`}
                </p>
                {detail.status === "blocked" ? (
                  <>
                    <Button ref={anchor} onClick={() => setConfirm(true)}>
                      Reject blocker
                    </Button>
                    <Popover anchorRef={anchor} open={confirm} onClose={() => setConfirm(false)}>
                      <div className={styles.form}>
                        <p>Reject this blocker? Voters will be asked to keep working.</p>
                        <Button variant="primary" disabled={mutation.busy} onClick={reject}>
                          Confirm
                        </Button>
                        <Button onClick={() => setConfirm(false)}>Cancel</Button>
                      </div>
                    </Popover>
                  </>
                ) : blocker.rejectedRevision === blocker.revision ? (
                  <p>Blocker rejected</p>
                ) : null}
              </div>
            </>
          )
        )}
      </Section>
    </div>
  );
}
