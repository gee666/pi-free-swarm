import { useEffect, useState } from "react";
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
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setText("");
    setError(undefined);
  }, [postId]);

  const send = () => {
    if (postId === undefined) return;
    setBusy(true);
    setError(undefined);
    createComment(swarmId, postId, { text })
      .then((response) => {
        onCreated(response);
        setText("");
      })
      .catch((failure: Error) => setError(failure.message))
      .finally(() => setBusy(false));
  };
  return { text, setText, send, busy, error };
}
