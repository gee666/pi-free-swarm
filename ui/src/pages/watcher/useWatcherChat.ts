import { useState } from "react";
import type { WatcherChatResponse } from "../../../../src/api-types";
import { getJson, postJson } from "../../api/http";
import { useSwarmStream } from "../../api/SwarmStream";
import { useAsync } from "../../api/useAsync";
import { useStreamListener } from "../../api/useEventStream";
import { useComposerDraft } from "../../components/compose/ComposerDrafts";
import { orderPost, withComment, withUserPostAttention } from "../wall/wallModel";

export function useWatcherChat(swarmId: string) {
  const stream = useSwarmStream();
  const url = `/api/swarms/${encodeURIComponent(swarmId)}/watcher`;
  const state = useAsync(
    (signal) =>
      getJson<WatcherChatResponse>(url, signal).then((response) => ({
        conversation: response.conversation ? orderPost(response.conversation) : null,
      })),
    [swarmId, stream.openCount],
  );
  const [text, setText, clearSubmitted] = useComposerDraft(`watcher:${swarmId}`);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<Error>();
  useStreamListener(stream, (event) => {
    if (event.type === "post.created" && !state.data?.conversation) state.reload();
    if (event.type === "user.post.updated") {
      state.update((current) =>
        current?.conversation
          ? {
              conversation: {
                ...current.conversation,
                post: withUserPostAttention(current.conversation.post, event.payload),
              },
            }
          : current,
      );
    }
    if (event.type !== "comment.created") return;
    state.update((current) => {
      if (!current?.conversation || current.conversation.post.id !== event.payload.comment.postId) return current;
      return { conversation: withComment(current.conversation, event.payload.comment, event.payload.commentCount) };
    });
  });
  const send = async () => {
    if (busy) return;
    setBusy(true);
    setSendError(undefined);
    try {
      await postJson<WatcherChatResponse>(url, { text });
      clearSubmitted();
      // Reload rather than replacing live comments with a possibly older POST snapshot.
      state.reload();
    } catch (error) {
      setSendError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setBusy(false);
    }
  };
  return { ...state, text, setText, send, busy, sendError };
}
