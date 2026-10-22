import { useEffect, useState } from "react";
import { WATCHER_NAME } from "../../../../src/constants";
import { markUserRead, USER_NAME } from "../../api/agents";
import { useSwarmStream } from "../../api/SwarmStream";
import { useAsync } from "../../api/useAsync";
import { useStreamListener } from "../../api/useEventStream";
import { fetchWatcher, sendWatcherMessage } from "../../api/watcher";

export function useWatcher(swarmId: string) {
  const stream = useSwarmStream();
  const chat = useAsync((signal) => fetchWatcher(swarmId, signal), [swarmId, stream.openCount]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  useStreamListener(stream, (event) => {
    if (
      event.type === "message.created" &&
      (event.payload.message.sender === WATCHER_NAME ||
        event.payload.message.recipients.some((recipient) => recipient.name === WATCHER_NAME))
    )
      chat.reload();
    if (event.type === "message.status" && event.payload.threadId === chat.data?.thread.id) chat.reload();
    if (event.type === "participant.updated" && event.payload.participant.name === WATCHER_NAME) {
      const participant = event.payload.participant;
      if (participant.kind === "agent" && ["idle", "crashed", "stopped"].includes(participant.status)) chat.reload();
    }
  });
  useEffect(() => {
    const ids =
      chat.data?.messages
        .filter((message) =>
          message.recipients.some((recipient) => recipient.name === USER_NAME && recipient.status !== "read"),
        )
        .map((message) => message.id) ?? [];
    if (ids.length)
      void markUserRead(swarmId, ids).catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : String(failure)),
      );
  }, [chat.data, swarmId]);
  const send = async () => {
    if (sending) return;
    setSending(true);
    setError(undefined);
    try {
      await sendWatcherMessage(swarmId, text);
      setText("");
      chat.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSending(false);
    }
  };
  return { chat, text, setText, sending, error, send };
}
