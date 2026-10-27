import { Fragment, useEffect, useState } from "react";
import { Check, Circle } from "lucide-react";
import type { TaskDetailResponse, TaskEvent, TaskRecord, TaskStatus } from "../../../../src/api-types";
import { getJson } from "../../api/http";
import { AuthoredEntry } from "../../components/AuthoredEntry";
import { Button } from "../../components/Button";
import { EntityHeader } from "../../components/EntityHeader";
import { IdLink } from "../../components/IdLink";
import { Markdown } from "../../components/Markdown";
import { Panel, PanelBody } from "../../components/Panel";
import { Pill } from "../../components/Pill";
import { RichText } from "../../components/RichText";
import { Section } from "../../components/Section";
import { ErrorBanner, SkeletonRows } from "../../components/States";
import { StatusGlyph, statusLabels } from "../../components/StatusGlyph";
import { formatTimestamp } from "../../lib/time";
import { Discussions } from "../work-items/Discussions";
import { useWorkDetail, workUrl } from "../work-items/useWorkData";
import styles from "../work-items/WorkItems.module.css";
import { TaskActions } from "./TaskActions";
import { TaskForm } from "./TaskForm";

const steps: TaskStatus[] = ["new", "claimed", "in_progress", "review", "accepted"];
export function TaskStepper({ task }: { task: Pick<TaskDetailResponse, "status" | "waiting" | "waitsOn"> }) {
  const current = steps.indexOf(task.status);
  return (
    <>
      <ol aria-label="Task lifecycle" className={styles.stepper}>
        {steps.map((status, index) => (
          <Fragment key={status}>
            {index > 0 && <span className={styles.connector} aria-hidden="true" />}
            <li
              className={index === current ? styles.current : styles.step}
              aria-current={index === current ? "step" : undefined}
            >
              {index < current ? (
                <Check size={12} aria-hidden="true" />
              ) : (
                <Circle size={8} fill={index === current ? "currentColor" : "none"} aria-hidden="true" />
              )}{" "}
              {status === "review" ? "Review" : statusLabels[status]}
            </li>
          </Fragment>
        ))}
      </ol>
      {task.waiting && (
        <p className={styles.muted}>
          Waiting on {task.waitsOn.map((id) => `#${id}`).join(", ")} — the owner is notified when they are accepted
        </p>
      )}
    </>
  );
}
function TaskLinks({ swarmId, tasks }: { swarmId: string; tasks: TaskRecord[] }) {
  return (
    <>
      {tasks.map((item) => (
        <div key={item.id} className={styles.line}>
          <StatusGlyph status={item.status} />
          <IdLink swarmId={swarmId} kind="task" id={item.id} title={item.title} />
          <span>{item.title}</span>
          <span className={styles.muted}>{statusLabels[item.status]}</span>
        </div>
      ))}
    </>
  );
}

export function TaskDetail({ swarmId, id, onChanged }: { swarmId: string; id: number; onChanged: () => void }) {
  const state = useWorkDetail<TaskDetailResponse>(swarmId, `tasks/${id}`);
  const [editing, setEditing] = useState(false);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [nextAfter, setNextAfter] = useState<number | null>(null);
  const [moreError, setMoreError] = useState<Error>();
  const [loadingMore, setLoadingMore] = useState(false);
  const detail = state.data;
  useEffect(() => {
    setEvents(detail?.timeline ?? []);
    setNextAfter(detail?.nextAfter ?? null);
  }, [detail]);
  const changed = () => {
    state.reload();
    onChanged();
  };
  const loadMore = async () => {
    if (nextAfter === null || loadingMore) return;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await getJson<TaskDetailResponse>(workUrl(swarmId, `tasks/${id}?after=${nextAfter}`));
      setEvents((current) => {
        const known = new Set(current.map((event) => event.id));
        return [...current, ...page.timeline.filter((event) => !known.has(event.id))];
      });
      setNextAfter(page.nextAfter);
    } catch (failure) {
      setMoreError(failure instanceof Error ? failure : new Error(String(failure)));
    } finally {
      setLoadingMore(false);
    }
  };
  if (!detail || detail.id !== id)
    return (
      <Panel>
        {state.error ? (
          <ErrorBanner action={<Button onClick={state.reload}>Retry</Button>}>{state.error.message}</ErrorBanner>
        ) : (
          <SkeletonRows />
        )}
      </Panel>
    );
  if (editing)
    return (
      <TaskForm
        key={detail.revision}
        swarmId={swarmId}
        task={detail}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          changed();
        }}
        onReload={state.reload}
      />
    );
  return (
    <Panel aria-label="Task">
      <EntityHeader
        avatar={<StatusGlyph status={detail.status} waiting={detail.waiting} />}
        title={detail.title}
        subtitle={`#${id} · rev ${detail.revision} · created by ${detail.author} · updated ${formatTimestamp(detail.updatedAt)}`}
      />
      <TaskActions swarmId={swarmId} task={detail} onChanged={changed} onEdit={() => setEditing(true)} />
      <PanelBody className={styles.body}>
        {state.error && (
          <ErrorBanner action={<Button onClick={state.reload}>Retry</Button>}>{state.error.message}</ErrorBanner>
        )}
        <TaskStepper task={detail} />
        {detail.deferred && (
          <Pill>
            Deferred — blocker exception on{" "}
            {detail.criteria
              .filter((item) => item.status === "blocked")
              .map((item) => `#${item.criterionId}`)
              .join(", ")}
          </Pill>
        )}
        <Section title="Description">
          <Markdown source={detail.body} />
        </Section>
        <Section title="Criteria">
          {detail.criteria.map((item) => (
            <div key={item.criterionId} className={styles.entry}>
              <div className={styles.line}>
                <StatusGlyph status={item.status} />
                <IdLink swarmId={swarmId} kind="criterion" id={item.criterionId} title={item.title} />
                <span>{item.title}</span>
              </div>
              <p className={styles.muted}>{item.contribution}</p>
            </div>
          ))}
        </Section>
        <Section title="Depends on">
          <TaskLinks swarmId={swarmId} tasks={detail.dependencies} />
        </Section>
        <Section title="Blocks">
          <TaskLinks swarmId={swarmId} tasks={detail.dependents} />
        </Section>
        <Section title="Evidence">
          {detail.latestEvidence ? (
            <>
              <RichText text={detail.latestEvidence} />
              {detail.evidence && (
                <p className={styles.muted}>
                  {detail.evidence.actor} · {formatTimestamp(detail.evidence.createdAt)}
                </p>
              )}
            </>
          ) : (
            <p className={styles.muted}>No evidence yet</p>
          )}
          {detail.reviewerVerdict && (
            <div className={styles.entry}>
              <p className={styles.muted}>
                {detail.reviewerVerdict.actor} · {detail.reviewerVerdict.kind.replaceAll("_", " ")} ·{" "}
                {formatTimestamp(detail.reviewerVerdict.createdAt)}
              </p>
              <RichText text={detail.reviewerVerdict.body} />
            </div>
          )}
        </Section>
        <Section title="Timeline">
          {events.map((event) => (
            <AuthoredEntry
              key={event.id}
              author={event.actor}
              time={`${event.kind.replaceAll("_", " ")} · ${formatTimestamp(event.createdAt)}`}
            >
              <RichText text={[event.body, event.evidence].filter(Boolean).join("\n")} />
            </AuthoredEntry>
          ))}
          {moreError && <ErrorBanner>{moreError.message}</ErrorBanner>}
          {nextAfter !== null && (
            <Button disabled={loadingMore} onClick={loadMore}>
              Show more
            </Button>
          )}
        </Section>
        <Discussions swarmId={swarmId} kind="task" id={id} posts={detail.linkedPosts} />
      </PanelBody>
    </Panel>
  );
}
