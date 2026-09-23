import { useEffect, useState } from "react";
import type { SwarmListItem, ThreadView } from "../../../../src/api-types";
import { replyToThread, sendMessage } from "../../api/agents";
import { ApiError } from "../../api/http";
import { replyRecipients } from "./messageDisplay";

export interface Composer {
  text: string;
  setText: (text: string) => void;
  to: string[];
  setTo: (names: string[]) => void;
  /** Thread mode: replies go to the thread's members. */
  thread: ThreadView | undefined;
  /** Start a new thread to these participants. */
  address: (names: string[]) => void;
  reply: (thread: ThreadView) => void;
  cancelReply: () => void;
  send: () => void;
  busy: boolean;
  /** Swarm not accepting messages, as reported by the swarm record or by a 409 for it; false while loading. */
  disabled: boolean;
  /** Any other send failure, safe to show. */
  error: string | undefined;
}

/**
 * Compose state of the Agents tab. `defaultTo` (the selected agent) is restored whenever it changes and when
 * thread mode is cancelled.
 */
export function useComposer(swarmId: string, swarm: SwarmListItem | undefined, defaultTo: readonly string[]): Composer {
  const [text, setText] = useState("");
  const [to, setTo] = useState<string[]>([...defaultTo]);
  const [thread, setThread] = useState<ThreadView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // A 409 disables compose until the next swarm record (stream event or reload) says otherwise.
  const [rejectedFor, setRejectedFor] = useState<SwarmListItem>();

  const address = (names: string[]) => {
    setThread(undefined);
    setTo(names);
  };
  const defaultKey = defaultTo.join("\n");
  useEffect(() => address([...defaultTo]), [defaultKey]);

  const send = () => {
    setBusy(true);
    setError(undefined);
    const request = thread ? replyToThread(swarmId, thread.id, { text }) : sendMessage(swarmId, { to, text });
    request
      .then(
        () => setText(""),
        (failure: Error) => {
          if (failure instanceof ApiError && failure.code === "swarm_not_running") setRejectedFor(swarm);
          else setError(failure.message);
        },
      )
      .finally(() => setBusy(false));
  };

  return {
    text,
    setText: (next) => {
      setText(next);
      setError(undefined);
    },
    to,
    setTo,
    thread,
    address,
    reply: (next) => {
      setThread(next);
      setTo(replyRecipients(next));
    },
    cancelReply: () => address([...defaultTo]),
    send,
    busy,
    disabled: swarm !== undefined && (!swarm.acceptsMessages || rejectedFor === swarm),
    error,
  };
}
