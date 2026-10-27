import { useNavigate } from "react-router-dom";
import { ListChecks } from "lucide-react";
import type { CriterionDetailResponse } from "../../../../src/api-types";
import { AgentName } from "../../components/AgentName";
import { Button } from "../../components/Button";
import { EntityHeader } from "../../components/EntityHeader";
import { IdLink } from "../../components/IdLink";
import { Markdown } from "../../components/Markdown";
import { Panel, PanelBody } from "../../components/Panel";
import { RichText } from "../../components/RichText";
import { Section } from "../../components/Section";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { StatusGlyph } from "../../components/StatusGlyph";
import { StatusPill } from "../../components/StatusPill";
import { relativeTime } from "../../lib/time";
import { Discussions, discussionUrl } from "../work-items/Discussions";
import { FilterMenu } from "../work-items/FilterMenu";
import { useWorkDetail } from "../work-items/useWorkData";
import { useWorkMutation } from "../work-items/useWorkMutation";
import { useWorkEditor } from "../work-items/useWorkEditor";
import styles from "../work-items/WorkItems.module.css";
import { CriterionBlocker } from "./CriterionBlocker";
import { CriterionForm } from "./CriterionForm";
import { CriterionVotes } from "./CriterionVotes";

export function CriterionDetail({
  swarmId,
  id,
  groups,
  onChanged,
}: {
  swarmId: string;
  id: number;
  groups: string[];
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const state = useWorkDetail<CriterionDetailResponse>(swarmId, `criteria/${id}`);
  const editor = useWorkEditor<CriterionDetailResponse>(swarmId, `criteria/${id}`);
  const changed = () => {
    state.reload();
    onChanged();
  };
  const mutation = useWorkMutation(swarmId, changed);
  const detail = state.data;
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
      <CriterionForm
        key={editor.snapshot.revision}
        swarmId={swarmId}
        criterion={editor.snapshot}
        groups={groups}
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
    <Panel aria-label="Criterion">
      <EntityHeader
        avatar={<StatusGlyph status={detail.status} />}
        title={detail.title}
        subtitle={`#${id} · ${detail.group} · rev ${detail.revision} · by ${detail.author} · ${relativeTime(detail.updatedAt)}`}
        actions={
          <>
            <Button onClick={() => editor.edit(detail)}>Edit</Button>
            <Button onClick={() => navigate(discussionUrl(swarmId, "criterion", id))}>Start discussion</Button>
            <FilterMenu
              label="More"
              items={[
                { key: detail.archivedAt ? "restore" : "archive", label: detail.archivedAt ? "Restore" : "Archive" },
              ]}
              onSelect={(action) =>
                void mutation.mutate(`criteria/${id}/${action}`, { expectedRevision: detail.revision })
              }
            />
          </>
        }
      />
      <PanelBody className={styles.body}>
        {state.error && (
          <ErrorBanner action={<Button onClick={state.reload}>Retry</Button>}>{state.error.message}</ErrorBanner>
        )}
        {mutation.error && <ErrorBanner>{mutation.error.message}</ErrorBanner>}
        <div className={styles.line}>
          <StatusPill status={detail.status} label={detail.exceptionPending ? "Blocked · awaiting you" : undefined} />
          <span className={styles.muted}>{detail.reasons.join(" · ")}</span>
        </div>
        <Section title="Requirement">
          <Markdown source={detail.body} />
        </Section>
        <Section title="How to verify">
          <Markdown source={detail.verification} />
        </Section>
        {detail.source && (
          <Section title="Source">
            <RichText text={detail.source} />
          </Section>
        )}
        <Section title="Linked tasks">
          {detail.tasks.length === 0 && <EmptyState icon={ListChecks} text="No linked tasks" />}
          {detail.tasks.map((task) => (
            <div className={styles.entry} key={task.id}>
              <div className={styles.line}>
                <StatusGlyph status={task.status} />
                <IdLink swarmId={swarmId} kind="task" id={task.id} title={task.title} />
                <span>{task.title}</span>
                {task.owner && <AgentName name={task.owner} />}
              </div>
              <p className={styles.muted}>{task.contribution}</p>
            </div>
          ))}
        </Section>
        <CriterionVotes swarmId={swarmId} detail={detail} onChanged={changed} />
        <CriterionBlocker key={detail.blocker?.revision ?? 0} swarmId={swarmId} detail={detail} onChanged={changed} />
        <Discussions swarmId={swarmId} kind="criterion" id={id} posts={detail.linkedPosts} />
        <p className={styles.muted}>
          Created by {detail.author} · edited {Math.max(0, detail.revision - 1)} times
        </p>
      </PanelBody>
    </Panel>
  );
}
