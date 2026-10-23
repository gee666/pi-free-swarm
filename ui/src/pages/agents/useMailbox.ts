import type { MailboxKind, MailboxResponse } from "../../../../src/api-types";
import { fetchMailbox } from "../../api/agents";
import { useSwarmStream } from "../../api/SwarmStream";
import { useAsync, type AsyncState } from "../../api/useAsync";
import { useStreamListener } from "../../api/useEventStream";
import { useLoadMore, type LoadMore } from "../../api/useLoadMore";
import { applyMailboxEvent, orderMailbox, withOlderThreads } from "./mailboxModel";

const PAGE_SIZE = 20;

/** One box of a participant, kept live from the swarm stream; older threads load on demand. */
export function useMailbox(
  swarmId: string,
  name: string,
  box: MailboxKind,
  unreadOnly = false,
): AsyncState<MailboxResponse> & LoadMore {
  const stream = useSwarmStream();
  const state = useAsync(
    (signal) => fetchMailbox(swarmId, name, { box, count: PAGE_SIZE, unreadOnly }, signal).then(orderMailbox),
    [swarmId, name, box, unreadOnly, stream.openCount],
  );
  const { data, update, reload } = state;

  useStreamListener(stream, (event) => {
    if (!data) return;
    const relevantUnreadEvent =
      unreadOnly &&
      ((event.type === "message.created" &&
        event.payload.message.recipients.some((recipient) => recipient.name === name)) ||
        (event.type === "message.status" && event.payload.recipient.name === name));
    if (relevantUnreadEvent || applyMailboxEvent(data, event).kind === "reload") {
      reload();
      return;
    }
    update((current) => {
      if (!current) return current;
      const patch = applyMailboxEvent(current, event);
      return patch.kind === "patched" ? patch.mailbox : current;
    });
  });

  const more = useLoadMore(state, {
    loaded: (mailbox) => mailbox.threads.length,
    total: (mailbox) => mailbox.total,
    fetch: (offset) => fetchMailbox(swarmId, name, { box, count: PAGE_SIZE, offset, unreadOnly }).then(orderMailbox),
    merge: withOlderThreads,
  });
  return { ...state, ...more };
}
