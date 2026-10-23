import { useEffect, useRef, useState } from "react";
import type { CreateCommentResponse } from "../../../../src/api-types";
import { createComment } from "../../api/wall";
import { useComposerDraft } from "../../components/compose/ComposerDrafts";

export interface CommentComposer {
  text: string;
  setText: (text: string) => void;
  send: () => void;
  busy: boolean;
  error: string | undefined;
}

/** Each post keeps its own unsent comment while the User navigates. */
export function useCommentComposer(
  swarmId: string,
  postId: number | undefined,
  onCreated: (response: CreateCommentResponse) => void,
): CommentComposer {
  const revision = useRef(0);
  const [text, setText, clearSubmitted] = useComposerDraft(
    postId === undefined ? undefined : `comment:${swarmId}:${postId}`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    revision.current += 1;
    setError(undefined);
  }, [swarmId, postId]);

  const send = () => {
    if (postId === undefined) return;
    const submittedRevision = revision.current;
    setBusy(true);
    setError(undefined);
    createComment(swarmId, postId, { text })
      .then((response) => {
        onCreated(response);
        clearSubmitted();
      })
      .catch((failure: Error) => {
        if (revision.current === submittedRevision) setError(failure.message);
      })
      .finally(() => setBusy(false));
  };
  return {
    text,
    setText: (next) => {
      revision.current += 1;
      setText(next);
    },
    send,
    busy,
    error,
  };
}
