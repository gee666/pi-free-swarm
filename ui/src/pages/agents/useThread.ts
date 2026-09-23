import { useEffect, useState } from "react";
import type { MessageView, ThreadResponse } from "../../../../src/api-types";
import { fetchThread, markUserRead, USER_NAME } from "../../api/agents";
import { useSwarmStream } from "../../api/SwarmStream";
import { useAsync, type AsyncState } from "../../api/useAsync";
import { useStreamListener } from "../../api/useEventStream";
import { isUnreadFor, withMessage, withRecipient } from "./mailboxModel";

export interface Thread extends AsyncState<ThreadResponse> {
  markReadError: Error | undefined;
}

/** A whole thread, kept live; everything addressed to the user is marked read once it is on screen. */
export function useThread(swarmId: string, threadId: number): Thread {
  const stream = useSwarmStream();
  const state = useAsync((signal) => fetchThread(swarmId, threadId, signal), [swarmId, threadId, stream.openCount]);
  const { update } = state;

  useStreamListener(stream, (event) => {
    if (event.type === "message.created" && event.payload.message.threadId === threadId) {
      const { message } = event.payload;
      update((current) => current && { ...current, messages: withMessage(current.messages, message) });
    }
    if (event.type === "message.status" && event.payload.threadId === threadId) {
      const { messageId, recipient } = event.payload;
      update((current) => current && { ...current, messages: withRecipient(current.messages, messageId, recipient) });
    }
  });

  const markReadError = useMarkUserRead(swarmId, state.data?.messages ?? []);
  return { ...state, markReadError };
}

/** The new `read` statuses come back through `message.status` events, which also update the badges. */
function useMarkUserRead(swarmId: string, messages: readonly MessageView[]): Error | undefined {
  const [error, setError] = useState<Error>();
  const unreadIds = messages.filter((message) => isUnreadFor(message, USER_NAME)).map((message) => message.id);
  const key = unreadIds.join(",");
  useEffect(() => {
    if (unreadIds.length === 0) return;
    setError(undefined);
    markUserRead(swarmId, unreadIds).catch((failure: Error) => setError(failure));
    // `key` stands for `unreadIds`: a new array every render with the same content.
  }, [swarmId, key]);
  return error;
}
