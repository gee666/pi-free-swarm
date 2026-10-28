import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TaskDetailResponse } from "../../../../src/api-types";
import { Button } from "../../components/Button";
import { DetailHeader } from "../../components/DetailHeader";
import { StatusGlyph } from "../../components/StatusGlyph";
import { StatusPill } from "../../components/StatusPill";
import { relativeTime } from "../../lib/time";
import { ErrorBanner } from "../../components/States";
import { Tooltip } from "../../components/Tooltip";
import { discussionUrl } from "../work-items/Discussions";
import { FilterMenu } from "../work-items/FilterMenu";
import { LongField } from "../work-items/WorkFields";
import { useWorkMutation } from "../work-items/useWorkMutation";
import styles from "../work-items/WorkItems.module.css";

export function TaskHeader({
  swarmId,
  task,
  onChanged,
  onEdit,
}: {
  swarmId: string;
  task: TaskDetailResponse;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const [reopening, setReopening] = useState(false);
  const [text, setText] = useState("");
  const [handoff, setHandoff] = useState(false);
  const navigate = useNavigate();
  const mutation = useWorkMutation(swarmId, () => {
    setReopening(false);
    setText("");
    onChanged();
  });
  const allowed = (action: TaskDetailResponse["validActions"][number]) => task.validActions.includes(action);
  const act = (action: string, fields: object = {}) =>
    void mutation.mutate(`tasks/${task.id}/${action}`, { expectedRevision: task.revision, ...fields });
  const waiting = task.waiting ? `Waiting on ${task.waitsOn.map((id) => `#${id}`).join(", ")}` : "";
  const deferred = task.deferred
    ? `Deferred, blocked criteria ${task.criteria
        .filter((item) => item.status === "blocked")
        .map((item) => `#${item.criterionId}`)
        .join(", ")}`
    : "";
  const meta = [
    `#${task.id}`,
    `rev ${task.revision}`,
    `by ${task.author}`,
    relativeTime(task.updatedAt),
    waiting,
    deferred,
  ]
    .filter(Boolean)
    .join(" · ");
  const main = allowed("claim")
    ? "claim"
    : allowed("start") || (task.status === "claimed" && task.owner === "User" && task.waiting)
      ? "start"
      : allowed("reopen")
        ? "reopen"
        : undefined;
  return (
    <>
      <DetailHeader
        glyph={<StatusGlyph status={task.status} waiting={task.waiting} />}
        title={task.title}
        meta={
          <>
            <StatusPill status={task.status} />
            <span>{meta}</span>
          </>
        }
        metaLabel={meta}
        actions={
          <>
            {main && (
              <Tooltip content={waiting || main} focusable={main === "start" && Boolean(waiting)}>
                <Button
                  variant="primary"
                  disabled={mutation.busy || (main === "start" && Boolean(waiting))}
                  onClick={() => (main === "reopen" ? setReopening(true) : act(main))}
                >
                  {main === "claim" ? "Claim" : main === "start" ? "Start" : "Reopen"}
                </Button>
              </Tooltip>
            )}
            {allowed("edit") && <Button onClick={onEdit}>Edit</Button>}
            {handoff ? (
              <FilterMenu
                key="handoff"
                label="Hand off to"
                initialOpen
                onClose={() => setHandoff(false)}
                items={task.handoffTargets.map((name) => ({ key: name, label: name }))}
                onSelect={(to) => act("handoff", { to })}
              />
            ) : (
              <FilterMenu
                key="more"
                label="More"
                items={[
                  ...(allowed("release") ? [{ key: "release", label: "Release" }] : []),
                  ...(allowed("handoff") ? [{ key: "handoff", label: "Hand off…" }] : []),
                  { key: "discussion", label: "Start discussion" },
                ]}
                onSelect={(key) => {
                  if (key === "release") act("release");
                  else if (key === "handoff") setHandoff(true);
                  else navigate(discussionUrl(swarmId, "task", task.id));
                }}
              />
            )}
          </>
        }
      />
      {mutation.error && <ErrorBanner>{mutation.error.message}</ErrorBanner>}
      {reopening && (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) act("reopen", { reason: text });
          }}
        >
          <LongField label="Reason" required value={text} onChange={setText} />
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={mutation.busy || !text.trim()}>
              Reopen
            </Button>
            <Button onClick={() => setReopening(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </>
  );
}
