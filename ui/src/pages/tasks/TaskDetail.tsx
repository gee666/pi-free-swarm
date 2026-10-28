import { useEffect, useState } from "react";
import type { TaskDetailResponse, TaskEvent, TaskRecord } from "../../../../src/api-types";
import { getJson } from "../../api/http";
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
import { useWorkDetail, workUrl } from "../work-items/useWorkData";
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
  const state = useWorkDetail<TaskDetailResponse>(swarmId, `tasks/${id}`);
  const editor = useWorkEditor<TaskDetailResponse>(swarmId, `tasks/${id}`);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [nextAfter, setNextAfter] = useState<number | null>(null);
  const [moreError, setMoreError] = useState<Error>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [visibleEvents, setVisibleEvents] = useState(10);
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
      setVisibleEvents((visible) => visible + 10);
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
            {moreError && <ErrorBanner>{moreError.message}</ErrorBanner>}
            {(events.length > visibleEvents || nextAfter !== null) && (
              <Button
                size="sm"
                disabled={loadingMore}
                onClick={() =>
                  events.length > visibleEvents ? setVisibleEvents((visible) => visible + 10) : void loadMore()
                }
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
