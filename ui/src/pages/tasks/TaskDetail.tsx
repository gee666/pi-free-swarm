import { useState } from "react";
import type { TaskDetailResponse, TaskRecord } from "../../../../src/api-types";
import { Button } from "../../components/Button";
import { IdLink } from "../../components/IdLink";
import { Markdown } from "../../components/Markdown";
import { Panel, PanelBody } from "../../components/Panel";
import { RichText } from "../../components/RichText";
import { Section } from "../../components/Section";
import { ErrorBanner, SkeletonRows } from "../../components/States";
import { StatusGlyph } from "../../components/StatusGlyph";
import { relativeTime } from "../../lib/time";
import { Discussions } from "../work-items/Discussions";
import { useTaskDetail } from "./useTaskDetail";
import { useWorkEditor } from "../work-items/useWorkEditor";
import styles from "../work-items/WorkItems.module.css";
import { TaskHeader } from "./TaskHeader";
import { TaskForm } from "./TaskForm";
import { TaskTimeline } from "./TaskTimeline";

function TaskLinks({ swarmId, tasks }: { swarmId: string; tasks: TaskRecord[] }) {
  return (
    <div>
      {tasks.map((item) => (
        <div key={item.id} className={styles.compactRow}>
          <StatusGlyph status={item.status} />
          <IdLink swarmId={swarmId} kind="task" id={item.id} title={item.title} />
          <span className={styles.ellipsis}>{item.title}</span>
          {item.owner && <span className={styles.owner}>{item.owner}</span>}
        </div>
      ))}
    </div>
  );
}

export function TaskDetail({ swarmId, id, onChanged }: { swarmId: string; id: number; onChanged: () => void }) {
  const state = useTaskDetail(swarmId, id);
  const editor = useWorkEditor<TaskDetailResponse>(swarmId, `tasks/${id}`);
  const [visibleEvents, setVisibleEvents] = useState(10);
  const detail = state.data;
  const events = detail?.timeline ?? [];
  const changed = () => {
    state.reload();
    onChanged();
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
  if (editor.snapshot)
    return (
      <TaskForm
        key={editor.snapshot.revision}
        swarmId={swarmId}
        task={editor.snapshot}
        onCancel={() => editor.edit(undefined)}
        onSaved={() => {
          editor.edit(undefined);
          changed();
        }}
        onReload={editor.reload}
        reloadError={editor.error}
      />
    );
  return (
    <Panel aria-label="Task">
      <TaskHeader swarmId={swarmId} task={detail} onChanged={changed} onEdit={() => editor.edit(detail)} />
      <PanelBody className={styles.body}>
        {state.error && (
          <ErrorBanner action={<Button onClick={state.reload}>Retry</Button>}>{state.error.message}</ErrorBanner>
        )}
        {detail.body && (
          <Section title="Description">
            <Markdown source={detail.body} />
          </Section>
        )}
        {detail.criteria.length > 0 && (
          <Section title="Criteria">
            <div>
              {detail.criteria.map((item) => (
                <div key={item.criterionId} className={styles.compactRow} title={item.contribution}>
                  <StatusGlyph status={item.status} />
                  <IdLink swarmId={swarmId} kind="criterion" id={item.criterionId} title={item.title} />
                  <span className={styles.ellipsis}>{item.title}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
        {detail.dependencies.length > 0 && (
          <Section title="Depends on">
            <TaskLinks swarmId={swarmId} tasks={detail.dependencies} />
          </Section>
        )}
        {detail.dependents.length > 0 && (
          <Section title="Blocks">
            <TaskLinks swarmId={swarmId} tasks={detail.dependents} />
          </Section>
        )}
        {(detail.latestEvidence || detail.reviewVerdict) && (
          <Section title="Evidence">
            {detail.latestEvidence ? (
              <>
                <RichText text={detail.latestEvidence} />
                {detail.evidence && (
                  <p className={styles.muted}>
                    {detail.evidence.actor} · {relativeTime(detail.evidence.createdAt)}
                  </p>
                )}
              </>
            ) : null}
            {detail.reviewVerdict && (
              <div className={styles.entry}>
                <p className={styles.muted}>
                  {detail.reviewVerdict.actor} · {detail.reviewVerdict.kind.replaceAll("_", " ")} ·{" "}
                  {relativeTime(detail.reviewVerdict.createdAt)}
                </p>
                <RichText text={detail.reviewVerdict.body} />
              </div>
            )}
          </Section>
        )}
        {events.length > 0 && (
          <Section title="Timeline">
            <TaskTimeline events={events.slice(0, visibleEvents)} />
            {state.loadMoreError && <ErrorBanner>{state.loadMoreError.message}</ErrorBanner>}
            {(events.length > visibleEvents || state.hasMore) && (
              <Button
                size="sm"
                disabled={state.loadingMore || state.loading}
                onClick={() => {
                  if (events.length <= visibleEvents) state.loadMore();
                  setVisibleEvents((visible) => visible + 10);
                }}
              >
                Show more
              </Button>
            )}
          </Section>
        )}
        <Discussions swarmId={swarmId} posts={detail.linkedPosts} />
      </PanelBody>
    </Panel>
  );
}
