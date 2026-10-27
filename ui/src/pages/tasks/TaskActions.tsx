import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TaskDetailResponse } from "../../../../src/api-types";
import { useSwarmDetail } from "../../api/SwarmView";
import { Button } from "../../components/Button";
import { ErrorBanner } from "../../components/States";
import { Tooltip } from "../../components/Tooltip";
import { discussionUrl } from "../work-items/Discussions";
import { FilterMenu } from "../work-items/FilterMenu";
import { LongField } from "../work-items/WorkFields";
import { useWorkMutation } from "../work-items/useWorkMutation";
import styles from "../work-items/WorkItems.module.css";

export function TaskActions({
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
  const [form, setForm] = useState<"request-review" | "changes" | "reopen">();
  const [text, setText] = useState("");
  const [handoff, setHandoff] = useState(false);
  const swarm = useSwarmDetail(swarmId);
  const navigate = useNavigate();
  const mutation = useWorkMutation(swarmId, () => {
    setForm(undefined);
    setText("");
    onChanged();
  });
  const allowed = (action: TaskDetailResponse["validActions"][number]) => task.validActions.includes(action);
  const act = (action: string, fields: object = {}) =>
    void mutation.mutate(`tasks/${task.id}/${action}`, { expectedRevision: task.revision, ...fields });
  const waiting = task.waiting ? `Waiting on ${task.waitsOn.map((id) => `#${id}`).join(", ")}` : undefined;
  return (
    <div className={styles.form}>
      {mutation.error && <ErrorBanner>{mutation.error.message}</ErrorBanner>}
      <div className={styles.actions}>
        {allowed("claim") && (
          <Button variant="primary" disabled={mutation.busy} onClick={() => act("claim")}>
            Claim
          </Button>
        )}
        {(allowed("start") || (task.status === "claimed" && task.owner === "User" && task.waiting)) && (
          <Tooltip content={waiting ?? "Start"}>
            <Button variant="primary" disabled={mutation.busy || Boolean(waiting)} onClick={() => act("start")}>
              Start
            </Button>
          </Tooltip>
        )}
        {allowed("request-review") && (
          <Button variant="primary" onClick={() => setForm("request-review")}>
            Request review
          </Button>
        )}
        {allowed("release") && (
          <Button disabled={mutation.busy} onClick={() => act("release")}>
            Release
          </Button>
        )}
        {allowed("review") && (
          <>
            <Button
              variant="primary"
              disabled={mutation.busy}
              onClick={() => act("review", { verdict: "accept", reason: "" })}
            >
              Accept
            </Button>
            <Button onClick={() => setForm("changes")}>Request changes</Button>
          </>
        )}
        {allowed("reopen") && <Button onClick={() => setForm("reopen")}>Reopen</Button>}
        <FilterMenu
          label="More"
          items={[
            ...(allowed("edit") ? [{ key: "edit", label: "Edit" }] : []),
            ...(allowed("handoff") ? [{ key: "handoff", label: "Hand off…" }] : []),
            { key: "discussion", label: "Start discussion" },
          ]}
          onSelect={(key) => {
            if (key === "edit") onEdit();
            else if (key === "handoff") setHandoff(true);
            else navigate(discussionUrl(swarmId, "task", task.id));
          }}
        />
        {handoff && (
          <FilterMenu
            label="Hand off to"
            items={
              swarm.data?.participants
                .filter((p) => p.kind === "agent" && p.retiredAt == null)
                .map((p) => ({ key: p.name, label: p.name })) ?? []
            }
            onSelect={(to) => {
              act("handoff", { to });
              setHandoff(false);
            }}
          />
        )}
      </div>
      {form && (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (form === "request-review") act(form, { evidence: text });
            else if (form === "changes") act("review", { verdict: "changes", reason: text });
            else act(form, { reason: text });
          }}
        >
          <LongField label={form === "request-review" ? "Evidence" : "Reason"} value={text} onChange={setText} />
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={mutation.busy || !text.trim()}>
              {form === "request-review" ? "Request review" : form === "changes" ? "Request changes" : "Reopen"}
            </Button>
            <Button onClick={() => setForm(undefined)}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}
