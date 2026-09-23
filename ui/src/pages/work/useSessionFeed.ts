import { useEffect, useRef, useState } from "react";
import type { SessionItem, SessionPage } from "../../../../src/api-types";
import { useStreamListener, type EventStream } from "../../api/useEventStream";
import { fetchSessionPage } from "../../api/work";
import { appendOlder, prependNewer } from "./feedMerge";

interface FeedData {
  items: SessionItem[];
  olderCursor: string | null;
  newestCursor: string | null;
}

export interface SessionFeed {
  /** Newest first; `undefined` until the first page arrived. */
  items: SessionItem[] | undefined;
  /** The first page failed. */
  error: Error | undefined;
  hasOlder: boolean;
  loadingOlder: boolean;
  olderError: Error | undefined;
  /** A live catch-up failed; the next `session.appended` or `retryNewer` tries again. */
  newerError: Error | undefined;
  loadOlder: () => void;
  retry: () => void;
  retryNewer: () => void;
}

interface SessionFeedOptions {
  swarmId: string;
  agent: string;
  stream: EventStream;
  /** Called right before `count` new items go on top, so the view can keep its scroll position. */
  onBeforePrepend: (count: number) => void;
}

const toError = (reason: unknown) => (reason instanceof Error ? reason : new Error(String(reason)));
const fromPage = (page: SessionPage): FeedData => ({
  items: page.items,
  olderCursor: page.olderCursor,
  newestCursor: page.newestCursor,
});

/**
 * One agent's session feed: the newest page once the stream is open, older pages on demand, and newer
 * entries after every `session.appended` and reconnect. Mount it per agent (`key={agent}`).
 */
export function useSessionFeed({ swarmId, agent, stream, onBeforePrepend }: SessionFeedOptions): SessionFeed {
  const [data, setData] = useState<FeedData>();
  const [error, setError] = useState<Error>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<Error>();
  const [newerError, setNewerError] = useState<Error>();
  const [attempt, setAttempt] = useState(0);
  // Async callbacks read the latest feed and flags from refs; state only drives rendering.
  const current = useRef<FeedData>();
  const lifetime = useRef(new AbortController());
  const olderBusy = useRef(false);
  const newer = useRef({ running: false, again: false });
  const beforePrepend = useRef(onBeforePrepend);
  beforePrepend.current = onBeforePrepend;

  const commit = (next: FeedData) => {
    current.current = next;
    setData(next);
  };

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    current.current = undefined;
    newer.current = { running: false, again: false };
    olderBusy.current = false;
    setData(undefined);
    setLoadingOlder(false);
    setOlderError(undefined);
    setNewerError(undefined);
    return () => controller.abort();
  }, [swarmId, agent]);

  // One catch-up at a time; events that arrive meanwhile (or before the first page) trigger one more round.
  const fetchNewer = async () => {
    const flags = newer.current;
    if (flags.running || !current.current) {
      flags.again = true;
      return;
    }
    flags.running = true;
    const { signal } = lifetime.current;
    try {
      do {
        flags.again = false;
        const base = current.current;
        if (!base) return;
        const query = base.newestCursor === null ? {} : { after: base.newestCursor };
        const page = await fetchSessionPage(swarmId, agent, query, signal);
        if (signal.aborted) return;
        const latest = current.current ?? base;
        const merged = prependNewer(latest.items, page.items);
        if (merged.added > 0) beforePrepend.current(merged.added);
        commit({
          items: merged.items,
          // A session that was empty so far gets its first page here, cursors included.
          olderCursor: base.newestCursor === null ? page.olderCursor : latest.olderCursor,
          newestCursor: page.newestCursor ?? latest.newestCursor,
        });
        setNewerError(undefined);
        // Cursors count persisted entries, not rendered items (some entries emit nothing).
        // Drain until the server stops advancing, including after reconnects without a target cursor.
        if (page.newestCursor !== null && page.newestCursor !== base.newestCursor) flags.again = true;
      } while (flags.again && !signal.aborted);
    } catch (reason) {
      if (!signal.aborted) setNewerError(toError(reason));
    } finally {
      flags.running = false;
    }
  };

  const opened = stream.openCount > 0;
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    setError(undefined);
    fetchSessionPage(swarmId, agent, {}, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return;
        commit(fromPage(page));
        if (newer.current.again) void fetchNewer();
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) setError(toError(reason));
      },
    );
    return () => controller.abort();
  }, [swarmId, agent, opened, attempt]);

  useStreamListener(stream, (event) => {
    if (event.type === "session.appended" && event.payload.agent === agent) void fetchNewer();
  });

  // After a reconnect, pick up whatever was appended while the stream was down.
  useEffect(() => {
    if (current.current) void fetchNewer();
  }, [stream.openCount]);

  const loadOlder = () => {
    const base = current.current;
    if (!base?.olderCursor || olderBusy.current) return;
    const { signal } = lifetime.current;
    olderBusy.current = true;
    setLoadingOlder(true);
    setOlderError(undefined);
    fetchSessionPage(swarmId, agent, { before: base.olderCursor }, signal)
      .then(
        (page) => {
          if (signal.aborted) return;
          const latest = current.current ?? base;
          commit({ ...latest, items: appendOlder(latest.items, page.items), olderCursor: page.olderCursor });
        },
        (reason: unknown) => {
          if (!signal.aborted) setOlderError(toError(reason));
        },
      )
      .finally(() => {
        if (signal.aborted) return;
        olderBusy.current = false;
        setLoadingOlder(false);
      });
  };

  return {
    items: data?.items,
    error,
    hasOlder: Boolean(data?.olderCursor),
    loadingOlder,
    olderError,
    newerError,
    loadOlder,
    retry: () => setAttempt((value) => value + 1),
    retryNewer: () => void fetchNewer(),
  };
}
