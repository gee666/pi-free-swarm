import { useEffect, useId, useRef, useState } from "react";
import type { DashboardResponse } from "../../../../src/api-types";
import { approveScope } from "../../api/dashboard";
import { Button } from "../../components/Button";
import { ErrorBanner } from "../../components/States";
import styles from "../../components/file-preview/FilePreview.module.css";

export function ScopeDialog({
  swarmId,
  data,
  onClose,
  onApproved,
}: {
  swarmId: string;
  data: DashboardResponse;
  onClose(): void;
  onApproved(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);
  const approve = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await approveScope(swarmId, data.project.scopeRevision);
      onApproved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <header className={styles.header}>
        <h2 id={title}>Approve scope rev {data.project.scopeRevision}</h2>
      </header>
      <div className={styles.body}>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <p>{data.project.intentSummary}</p>
        <p>
          {data.counts.criteria} active criteria in {data.criteriaCoverage.length} groups
        </p>
        <ul>
          {data.criteriaCoverage.map((group) => (
            <li key={group.group}>
              {group.group} · {group.total}
            </li>
          ))}
        </ul>
        <p>Later changes to the intent or criteria need approval again.</p>
      </div>
      <footer className={styles.footer}>
        <Button variant="primary" disabled={busy} onClick={() => void approve()}>
          Approve
        </Button>
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </footer>
    </dialog>
  );
}
