import { useCallback, useEffect, useRef, useState } from "react";
import type { WatcherChatResponse } from "../../../../src/api-types";
import { getJson, postJson } from "../../api/http";
import { useSwarmStream } from "../../api/SwarmStream";
import { useStreamListener } from "../../api/useEventStream";
import { useComposerDraft } from "../../components/compose/ComposerDrafts";

interface Mutation {
  kind: "send" | "new";
  controller: AbortController;
}

const failureMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useWatcherChat(swarmId: string) {
  const stream = useSwarmStream();
  const url = `/api/swarms/${encodeURIComponent(swarmId)}/watcher`;
  const [data, setData] = useState<WatcherChatResponse>();
  const [error, setError] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();
  const [pending, setPending] = useState<Mutation["kind"]>();
  const [text, setText, clearSubmitted] = useComposerDraft(`watcher:${swarmId}`);
  const snapshot = useRef<AbortController | undefined>(undefined);
  const mutation = useRef<Mutation | undefined>(undefined);

  const reload = useCallback(async () => {
    // Mutations supply their own snapshot, then fetch again to catch updates during the POST.
    if (mutation.current) return;
    snapshot.current?.abort();
    const controller = new AbortController();
    snapshot.current = controller;
    setError(undefined);
    try {
      const response = await getJson<WatcherChatResponse>(url, controller.signal);
      if (!controller.signal.aborted) setData(response);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failureMessage(failure));
    }
  }, [url]);

  useEffect(() => {
    void reload();
    return () => {
      snapshot.current?.abort();
      mutation.current?.controller.abort();
      mutation.current = undefined;
    };
  }, [reload]);
  useEffect(() => {
    if (stream.openCount > 0) void reload();
  }, [stream.openCount, reload]);
  useStreamListener(stream, (event) => {
    if (event.type === "watcher.chat.updated" && String(event.payload.swarmId) === swarmId) void reload();
  });

  const submit = async (kind: Mutation["kind"]) => {
    if (kind === "send" && (mutation.current || !text.trim() || !data || data.status === "working")) return;
    if (mutation.current?.kind === "new") return;
    // New can replace an in-flight send. Neither its POST nor an older GET may restore the old session.
    snapshot.current?.abort();
    mutation.current?.controller.abort();
    const operation: Mutation = { kind, controller: new AbortController() };
    mutation.current = operation;
    setPending(kind);
    setError(undefined);
    setMutationError(undefined);
    try {
      const response = await postJson<WatcherChatResponse>(
        kind === "new" ? `${url}/new` : url,
        kind === "new" ? {} : { text, sessionId: data?.sessionId ?? null },
        operation.controller.signal,
      );
      if (operation.controller.signal.aborted) return;
      setData(response);
      clearSubmitted();
    } catch (failure) {
      if (!operation.controller.signal.aborted) setMutationError(failureMessage(failure));
    } finally {
      if (mutation.current === operation) {
        mutation.current = undefined;
        setPending(undefined);
        void reload();
      }
    }
  };

  return {
    data,
    error,
    mutationError,
    reload: () => void reload(),
    text,
    setText,
    send: () => void submit("send"),
    newChat: () => void submit("new"),
    busy: pending !== undefined,
    resetting: pending === "new",
  };
}
