import { useState } from "react";
import { TITLE_MAX, USER_BODY_PREVIEW_CHARS } from "../../../../src/limits";
import type { CriterionLink, TaskDetailResponse, TaskRecord } from "../../../../src/api-types";
import { ApiError, postJson } from "../../api/http";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { ErrorBanner } from "../../components/States";
import { EntityPicker, type EntityChoice } from "../work-items/EntityPicker";
import { FilterPill } from "../work-items/FilterMenu";
import { LongField, LongTextNotice } from "../work-items/WorkFields";
import { workUrl } from "../work-items/useWorkData";
import styles from "../work-items/WorkItems.module.css";

interface CriterionChoice extends EntityChoice {
  contribution: string;
}
export function TaskForm({
  swarmId,
  task,
  onSaved,
  onCancel,
  onReload,
  reloadError,
}: {
  swarmId: string;
  task?: TaskDetailResponse;
  onSaved: (id: number) => void;
  onCancel: () => void;
  onReload?: () => void;
  reloadError?: Error;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [body, setBody] = useState(task?.body ?? "");
  const [criteria, setCriteria] = useState<CriterionChoice[]>(
    task?.criteria.map((item) => ({ id: item.criterionId, title: item.title, contribution: item.contribution })) ?? [],
  );
  const [dependencies, setDependencies] = useState<EntityChoice[]>(task?.dependencies ?? []);
  const [claim, setClaim] = useState(false);
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(undefined);
    const links: CriterionLink[] = criteria.map((item) => ({ criterionId: item.id, contribution: item.contribution }));
    const fields = { title, body, criteria: links, dependsOn: dependencies.map((item) => item.id) };
    try {
      const saved = await postJson<TaskRecord>(
        workUrl(swarmId, task ? `tasks/${task.id}/edit` : "tasks"),
        task ? { expectedRevision: task.revision, fields } : { ...fields, claim },
      );
      onSaved(saved.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(String(failure)));
    } finally {
      setBusy(false);
    }
  };
  const conflict = error instanceof ApiError && error.status === 409;
  return (
    <Panel aria-label={task ? "Edit task" : "New task"}>
      <PanelHeader title={task ? "Edit task" : "New task"} />
      <PanelBody>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {reloadError && (
            <ErrorBanner action={<Button onClick={onReload}>Retry</Button>}>{reloadError.message}</ErrorBanner>
          )}
          {error && (
            <ErrorBanner action={conflict && <Button onClick={onReload}>Reload</Button>}>
              {conflict ? "Changed by someone else — reload" : error.message}
            </ErrorBanner>
          )}
          <TextField label="Title" placeholder="Title" limit={TITLE_MAX} value={title} onChange={setTitle} />
          <LongField label="Description" value={body} onChange={setBody} />
          <div className={styles.field}>
            <span>Criteria links</span>
            {criteria.map((item) => (
              <div className={styles.entry} key={item.id}>
                <FilterPill
                  label={`#${item.id} ${item.title}`}
                  onRemove={() => setCriteria((current) => current.filter((choice) => choice.id !== item.id))}
                />
                <TextField
                  label={`Contribution to #${item.id}`}
                  placeholder="Contribution"
                  limit={USER_BODY_PREVIEW_CHARS}
                  value={item.contribution}
                  onChange={(contribution) =>
                    setCriteria((current) =>
                      current.map((choice) => (choice.id === item.id ? { ...choice, contribution } : choice)),
                    )
                  }
                />
                <LongTextNotice value={item.contribution} />
              </div>
            ))}
            <EntityPicker
              label="Add criterion"
              swarmId={swarmId}
              kind="criterion"
              excluded={criteria.map((item) => item.id)}
              onSelect={(item) => setCriteria((current) => [...current, { ...item, contribution: "" }])}
            />
          </div>
          <div className={styles.field}>
            <span>Depends on</span>
            <div className={styles.actions}>
              {dependencies.map((item) => (
                <FilterPill
                  key={item.id}
                  label={`#${item.id} ${item.title}`}
                  onRemove={() => setDependencies((current) => current.filter((choice) => choice.id !== item.id))}
                />
              ))}
            </div>
            <EntityPicker
              label="Add dependency"
              swarmId={swarmId}
              kind="task"
              excluded={[...dependencies.map((item) => item.id), ...(task ? [task.id] : [])]}
              onSelect={(item) => setDependencies((current) => [...current, item])}
            />
          </div>
          {!task && (
            <label className={styles.line}>
              <input type="checkbox" checked={claim} onChange={(event) => setClaim(event.target.checked)} />
              Claim it myself
            </label>
          )}
          <div className={styles.actions}>
            <Button
              type="submit"
              variant="primary"
              disabled={
                busy ||
                conflict ||
                !title.trim() ||
                criteria.length === 0 ||
                criteria.some((item) => !item.contribution.trim())
              }
            >
              Save
            </Button>
            <Button onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
