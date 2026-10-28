import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CriterionDetailResponse } from "../../../../src/api-types";
import { Button } from "../../components/Button";
import { DetailHeader } from "../../components/DetailHeader";
import { IdLink } from "../../components/IdLink";
import { Markdown } from "../../components/Markdown";
import { Panel, PanelBody } from "../../components/Panel";
import { RichText } from "../../components/RichText";
import { Section } from "../../components/Section";
import { ErrorBanner, SkeletonRows } from "../../components/States";
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
  const [voting, setVoting] = useState(false);
  const [blocking, setBlocking] = useState(false);
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
  const meta = `#${id} · ${detail.group} · rev ${detail.revision} · by ${detail.author} · ${relativeTime(detail.updatedAt)}`;
  const reasons = detail.reasons.join(" · ");
  return (
    <Panel aria-label="Criterion">
      <DetailHeader
        glyph={<StatusGlyph status={detail.status} />}
        title={detail.title}
        meta={
          <>
            <StatusPill status={detail.status} />
            <span>
              {reasons && `${reasons} · `}
              {meta}
            </span>
          </>
        }
        metaLabel={[reasons, meta].filter(Boolean).join(" · ")}
        actions={
          <>
            <Button variant="primary" aria-expanded={voting} onClick={() => setVoting(true)}>
              Vote
            </Button>
            <Button onClick={() => editor.edit(detail)}>Edit</Button>
            <FilterMenu
              label="More"
              items={[
                { key: "discussion", label: "Start discussion" },
                { key: "blocker", label: "Record blocker" },
                { key: detail.archivedAt ? "restore" : "archive", label: detail.archivedAt ? "Restore" : "Archive" },
              ]}
              onSelect={(action) => {
                if (action === "discussion") navigate(discussionUrl(swarmId, "criterion", id));
                else if (action === "blocker") setBlocking(true);
                else void mutation.mutate(`criteria/${id}/${action}`, { expectedRevision: detail.revision });
              }}
            />
          </>
        }
      />
      <PanelBody className={styles.body}>
        {state.error && (
          <ErrorBanner action={<Button onClick={state.reload}>Retry</Button>}>{state.error.message}</ErrorBanner>
        )}
        {mutation.error && <ErrorBanner>{mutation.error.message}</ErrorBanner>}
        {detail.body && (
          <Section title="Requirement">
            <Markdown source={detail.body} />
          </Section>
        )}
        {detail.verification && (
          <Section title="How to verify">
            <Markdown source={detail.verification} />
          </Section>
        )}
        {detail.source && (
          <Section title="Source">
            <RichText text={detail.source} />
          </Section>
        )}
        <Section title="Linked tasks">
          {detail.tasks.length === 0 && <p className={styles.muted}>No linked tasks</p>}
          {detail.tasks.length > 0 && (
            <div>
              {detail.tasks.map((task) => (
                <div className={styles.compactRow} key={task.id} title={task.contribution}>
                  <StatusGlyph status={task.status} />
                  <IdLink swarmId={swarmId} kind="task" id={task.id} title={task.title} />
                  <span className={styles.ellipsis}>{task.title}</span>
                  {task.owner && <span className={styles.owner}>{task.owner}</span>}
                </div>
              ))}
            </div>
          )}
        </Section>
        <CriterionVotes
          swarmId={swarmId}
          detail={detail}
          open={voting}
          onClose={() => setVoting(false)}
          onChanged={changed}
        />
        <CriterionBlocker
          key={detail.blocker?.revision ?? 0}
          swarmId={swarmId}
          detail={detail}
          editing={blocking}
          onClose={() => setBlocking(false)}
          onChanged={changed}
        />
        <Discussions swarmId={swarmId} posts={detail.linkedPosts} />
      </PanelBody>
    </Panel>
  );
}
