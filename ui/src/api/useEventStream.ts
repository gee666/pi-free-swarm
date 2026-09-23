import { useCallback, useEffect, useRef, useState } from "react";
import type { SwarmEvent } from "../../../src/api-types";

export type StreamStatus = "connecting" | "open" | "reconnecting";

export type SwarmEventListener = (event: SwarmEvent) => void;

export interface EventStream {
  /** "reconnecting" drives the "Connection lost. Reconnecting…" banner. */
  status: StreamStatus;
  /**
   * Increments on every (re)open. Fetch snapshots only once the stream is open, so no change falls between
   * snapshot and stream: use it as a `useAsync` dependency, load when it is > 0, reload after reconnects.
   */
  openCount: number;
  subscribe: (listener: SwarmEventListener) => () => void;
}

// EventSource retries on its own while CONNECTING; this only covers the CLOSED state (e.g. an HTTP error).
const REOPEN_DELAY_MS = 3000;

/** One EventSource for `url` (`/events` or `/events?swarm=:id`), shared by any number of listeners. */
export function useEventStream(url: string): EventStream {
  const listeners = useRef(new Set<SwarmEventListener>());
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [openCount, setOpenCount] = useState(0);

  useEffect(() => {
    let source: EventSource | undefined;
    let reopenTimer: number | undefined;
    const open = () => {
      source = new EventSource(url);
      source.onopen = () => {
        setStatus("open");
        setOpenCount((count) => count + 1);
      };
      source.onmessage = (message: MessageEvent<string>) => {
        const event: SwarmEvent = JSON.parse(message.data);
        for (const listener of listeners.current) listener(event);
      };
      source.onerror = () => {
        setStatus("reconnecting");
        if (source?.readyState !== EventSource.CLOSED) return;
        source.close();
        reopenTimer = window.setTimeout(open, REOPEN_DELAY_MS);
      };
    };
    setStatus("connecting");
    open();
    return () => {
      window.clearTimeout(reopenTimer);
      source?.close();
    };
  }, [url]);

  const subscribe = useCallback((listener: SwarmEventListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return { status, openCount, subscribe };
}

/** Calls `listener` for every event of `stream`; the latest closure is used without resubscribing. */
export function useStreamListener(stream: EventStream, listener: SwarmEventListener): void {
  const latest = useRef(listener);
  latest.current = listener;
  const { subscribe } = stream;
  useEffect(() => subscribe((event) => latest.current(event)), [subscribe]);
}
