import type { MailboxKind, MailboxResponse } from "../../../../src/api-types";
import { fetchMailbox } from "../../api/agents";
import { useSwarmStream } from "../../api/SwarmStream";
import { useAsync, type AsyncState } from "../../api/useAsync";
import { useStreamListener } from "../../api/useEventStream";
import { useLoadMore, type LoadMore } from "../../api/useLoadMore";
import { applyMailboxEvent, withOlderThreads } from "./mailboxModel";

const PAGE_SIZE = 20;

/** One box of a participant, kept live from the swarm stream; older threads load on demand. */
export function useMailbox(swarmId: string, name: string, box: MailboxKind): AsyncState<MailboxResponse> & LoadMore {
  const stream = useSwarmStream();
  const state = useAsync(
    (signal) => fetchMailbox(swarmId, name, { box, count: PAGE_SIZE }, signal),
    [swarmId, name, box, stream.openCount],
  );
  const { data, update, reload } = state;

  useStreamListener(stream, (event) => {
    if (!data) return;
    if (applyMailboxEvent(data, event).kind === "reload") {
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
    fetch: (offset) => fetchMailbox(swarmId, name, { box, count: PAGE_SIZE, offset }),
    merge: withOlderThreads,
  });
  return { ...state, ...more };
}
