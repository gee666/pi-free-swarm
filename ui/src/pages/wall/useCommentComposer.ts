import { useEffect, useRef, useState } from "react";
import type { CreateCommentResponse } from "../../../../src/api-types";
import { createComment } from "../../api/wall";

export interface CommentComposer {
  text: string;
  setText: (text: string) => void;
  send: () => void;
  busy: boolean;
  error: string | undefined;
}

/** Comment box of the open post; the draft is dropped when another post opens. */
export function useCommentComposer(
  swarmId: string,
  postId: number | undefined,
  onCreated: (response: CreateCommentResponse) => void,
): CommentComposer {
  const revision = useRef(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    revision.current += 1;
    setText("");
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
        if (revision.current === submittedRevision) setText("");
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
