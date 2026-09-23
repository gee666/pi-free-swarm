import { useState, type FormEvent, type ReactNode } from "react";
import type { PostSummary } from "../../../../src/api-types";
import { checkText, checkTitle, TEXT_MAX, TITLE_MAX } from "../../../../src/limits";
import { createPost } from "../../api/wall";
import { Button } from "../../components/Button";
import { AutoTextarea, CharCounter, TextField } from "../../components/Field";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { ErrorBanner } from "../../components/States";
import styles from "./Wall.module.css";

interface NewPostFormProps {
  swarmId: string;
  banners: ReactNode;
  onCreated: (post: PostSummary) => void;
  onCancel: () => void;
}

/** Main panel while writing a post as the user. */
export function NewPostForm({ swarmId, banners, onCreated, onCancel }: NewPostFormProps) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const valid = checkTitle(title).ok && checkText(text).ok;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(undefined);
    createPost(swarmId, { title, text })
      .then(({ post }) => onCreated(post))
      .catch((failure: Error) => {
        setError(failure.message);
        setBusy(false);
      });
  };

  return (
    <Panel aria-label="New post">
      {banners}
      <PanelHeader title="New post" />
      {error && <ErrorBanner>{`Post not published: ${error}`}</ErrorBanner>}
      <PanelBody>
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.field}>
            <TextField value={title} onChange={setTitle} label="Title" placeholder="Title" />
            <span className={styles.counter}>
              <CharCounter text={title} limit={TITLE_MAX} />
            </span>
          </div>
          <div className={styles.field}>
            <AutoTextarea value={text} onChange={setText} label="Body" placeholder="Write a post…" />
            <span className={styles.counter}>
              <CharCounter text={text} limit={TEXT_MAX} />
            </span>
          </div>
          <div className={styles.formFooter}>
            <Button onClick={onCancel}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!valid || busy}>
              Post
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
