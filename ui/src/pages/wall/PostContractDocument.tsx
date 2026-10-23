import { useState, type FormEvent } from "react";
import type { PostContract } from "../../../../src/api-types";
import { fetchPostContract, savePostContract } from "../../api/postContracts";
import { ApiError } from "../../api/http";
import { Button } from "../../components/Button";
import { AutoTextarea } from "../../components/Field";
import { RichText } from "../../components/RichText";
import { ErrorBanner } from "../../components/States";
import styles from "./Wall.module.css";

interface ContractDocumentProps {
  swarmId: number;
  contract?: PostContract | null;
  onSaved: (contract: PostContract) => void;
}

export function PostContractDocument({ swarmId, contract, onSaved }: ContractDocumentProps) {
  const [draft, setDraft] = useState<{ text: string; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!contract) return null;
  const changed = draft !== null && draft.revision !== contract.revision;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || busy || !draft.text.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await savePostContract(swarmId, contract.postId, draft.text, draft.revision);
      onSaved(saved.contract);
      setDraft(null);
    } catch (failure) {
      let message = failure instanceof Error ? failure.message : String(failure);
      if (failure instanceof ApiError && failure.status === 409) {
        try {
          const latest = await fetchPostContract(swarmId, contract.postId);
          if (latest) onSaved(latest);
        } catch (refreshFailure) {
          message += ` Could not load the latest contract: ${refreshFailure instanceof Error ? refreshFailure.message : String(refreshFailure)}. Retry Save to refresh again.`;
        }
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.contract} aria-label="Post contract">
      <details open>
        <summary>
          Contract{" "}
          <span>
            Revision {contract.revision} · {contract.updatedBy}
          </span>
        </summary>
        <div className={styles.contractText}>
          <RichText text={contract.text} />
          {draft ? (
            <form className={styles.contractEditor} onSubmit={(event) => void save(event)}>
              <AutoTextarea
                value={draft.text}
                onChange={(text) => setDraft({ ...draft, text })}
                label="Contract text"
                placeholder="Contract text"
                disabled={busy}
              />
              {changed && (
                <p role="status">
                  The contract changed to revision {contract.revision}. Merge the latest text above before saving.
                </p>
              )}
              {error && <ErrorBanner>{error}</ErrorBanner>}
              <div className={styles.contractActions}>
                <Button type="submit" disabled={busy || changed || !draft.text.trim()}>
                  Save contract
                </Button>
                {changed && (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => setDraft({ ...draft, revision: contract.revision })}
                  >
                    I've merged revision {contract.revision}
                  </Button>
                )}
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDraft(null);
                    setError(undefined);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className={styles.contractActions}>
              <Button
                size="sm"
                onClick={() => {
                  setDraft({ text: contract.text, revision: contract.revision });
                  setError(undefined);
                }}
              >
                Edit contract
              </Button>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
