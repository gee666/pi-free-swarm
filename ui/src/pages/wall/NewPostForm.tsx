import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { PostSummary } from "../../../../src/api-types";
import { checkTitle, TITLE_MAX, USER_BODY_PREVIEW_CHARS } from "../../../../src/limits";
import { createPost } from "../../api/wall";
import { IconButton } from "../../components/Button";
import { ComposeBox } from "../../components/compose/ComposeBox";
import { useComposerDraft } from "../../components/compose/ComposerDrafts";
import { TextField } from "../../components/Field";
import { ErrorBanner } from "../../components/States";
import { Tooltip } from "../../components/Tooltip";
import styles from "./Wall.module.css";

interface NewPostFormProps {
  swarmId: string;
  mentionNames?: readonly string[];
  banners: ReactNode;
  onCreated: (post: PostSummary) => void;
  onCancel: () => void;
}

export function NewPostForm({ swarmId, mentionNames, banners, onCreated, onCancel }: NewPostFormProps) {
  const [title, setTitle, clearSubmittedTitle] = useComposerDraft(`post:${swarmId}:title`);
  const [text, setText, clearSubmittedText] = useComposerDraft(`post:${swarmId}:body`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = () => {
    if (!checkTitle(title).ok || busy) return;
    setBusy(true);
    setError(undefined);
    createPost(swarmId, { title, text })
      .then(({ post }) => {
        clearSubmittedTitle();
        clearSubmittedText();
        onCreated(post);
      })
      .catch((failure: Error) => {
        setError(failure.message);
        setBusy(false);
      });
  };

  return (
    <section className={styles.newPost} aria-label="New post">
      {banners}
      {error && <ErrorBanner>{`Post not published: ${error}`}</ErrorBanner>}
      <ComposeBox
        text={text}
        onTextChange={setText}
        onSend={submit}
        placeholder="Write a post…"
        textareaLabel="Body"
        sendLabel="Post"
        sendDisabled={!checkTitle(title).ok}
        busy={busy}
        mentionNames={mentionNames}
        attachmentThreshold={USER_BODY_PREVIEW_CHARS}
        uploadSwarmId={swarmId}
      >
        <div className={styles.postTitle}>
          <TextField value={title} onChange={setTitle} label="Title" placeholder="Title" limit={TITLE_MAX} />
          <Tooltip content="Cancel">
            <IconButton
              icon={X}
              label="Cancel"
              onClick={() => {
                setTitle("");
                setText("");
                onCancel();
              }}
            />
          </Tooltip>
        </div>
      </ComposeBox>
    </section>
  );
}
