import { useState } from "react";
import type { CreateCriterionRequest, CriterionRecord } from "../../../../src/api-types";
import { ApiError, postJson } from "../../api/http";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { ErrorBanner } from "../../components/States";
import { LongField } from "../work-items/WorkFields";
import { workUrl } from "../work-items/useWorkData";
import styles from "../work-items/WorkItems.module.css";

export function CriterionForm({
  swarmId,
  criterion,
  groups,
  onSaved,
  onCancel,
  onReload,
}: {
  swarmId: string;
  criterion?: CriterionRecord;
  groups: string[];
  onSaved: (id: number) => void;
  onCancel: () => void;
  onReload?: () => void;
}) {
  const [fields, setFields] = useState<CreateCriterionRequest>({
    group: criterion?.group ?? "",
    title: criterion?.title ?? "",
    body: criterion?.body ?? "",
    verification: criterion?.verification ?? "",
    source: criterion?.source ?? "",
  });
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const change = (key: keyof CreateCriterionRequest, value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await postJson<CriterionRecord>(
        workUrl(swarmId, criterion ? `criteria/${criterion.id}/edit` : "criteria"),
        criterion ? { expectedRevision: criterion.revision, fields } : fields,
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
    <Panel aria-label={criterion ? "Edit criterion" : "New criterion"}>
      <PanelHeader title={criterion ? "Edit criterion" : "New criterion"} />
      <PanelBody>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {error && (
            <ErrorBanner action={conflict && <Button onClick={onReload}>Reload</Button>}>
              {conflict ? "Changed by someone else — reload" : error.message}
            </ErrorBanner>
          )}
          <label className={styles.field}>
            Group
            <input
              aria-label="Group"
              list="criterion-groups"
              value={fields.group}
              onChange={(event) => change("group", event.target.value)}
            />
          </label>
          <datalist id="criterion-groups">
            {groups.map((group) => (
              <option key={group} value={group} />
            ))}
          </datalist>
          <TextField
            label="Title"
            placeholder="Title"
            limit={60}
            value={fields.title}
            onChange={(value) => change("title", value)}
          />
          <LongField label="Requirement" value={fields.body} onChange={(value) => change("body", value)} />
          <LongField
            label="How to verify"
            value={fields.verification}
            onChange={(value) => change("verification", value)}
          />
          <LongField label="Source" value={fields.source} onChange={(value) => change("source", value)} />
          <div className={styles.actions}>
            <Button
              variant="primary"
              type="submit"
              disabled={busy || conflict || !fields.title.trim() || !fields.group.trim()}
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
