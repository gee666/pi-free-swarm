import { useEffect, useRef, useState } from "react";
import type { SearchPage, SwarmEvent } from "../../../../src/api-types";
import { getJson } from "../../api/http";
import { useAsync } from "../../api/useAsync";
import { useSwarmStream } from "../../api/SwarmStream";
import { useStreamListener } from "../../api/useEventStream";
import { REFRESH_DEBOUNCE_MS } from "../../lib/useDebounced";

export const workUrl = (swarmId: string, path: string) => `/api/swarms/${encodeURIComponent(swarmId)}/${path}`;

export function useWorkRefresh(reload: () => void, matches: (event: SwarmEvent) => boolean) {
  const stream = useSwarmStream();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useStreamListener(stream, (event) => {
    if (!matches(event)) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(reload, REFRESH_DEBOUNCE_MS);
  });
  return stream.openCount;
}

function affectsWork(event: SwarmEvent) {
  return ["criterion.changed", "task.changed", "post.links.changed", "participant.updated"].includes(event.type);
}

export function useWorkDetail<T>(swarmId: string, path: string | undefined) {
  const stream = useSwarmStream();
  const state = useAsync(
    (signal) => (path ? getJson<T>(workUrl(swarmId, path), signal) : Promise.resolve(undefined)),
    [swarmId, path, stream.openCount],
  );
  useWorkRefresh(state.reload, affectsWork);
  return state;
}

export function useWorkList<T extends { id: number }>(swarmId: string, path: string, query: string, enabled = true) {
  const stream = useSwarmStream();
  const state = useAsync(
    (signal) => getJson<SearchPage<T>>(workUrl(swarmId, `${path}?${query}`), signal),
    [swarmId, path, query, stream.openCount],
    enabled,
  );
  const [moreError, setMoreError] = useState<Error>();
  const [loadingMore, setLoadingMore] = useState(false);
  const key = `${swarmId}/${path}?${query}`;
  const activeKey = useRef(key);
  activeKey.current = key;
  useWorkRefresh(state.reload, affectsWork);
  const loadMore = async () => {
    const cursor = state.data?.nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const params = new URLSearchParams(query);
      params.set("cursor", cursor);
      const page = await getJson<SearchPage<T>>(workUrl(swarmId, `${path}?${params}`));
      if (activeKey.current !== key) return;
      state.update((current) => {
        if (!current) return page;
        const known = new Set(current.items.map((item) => item.id));
        return { ...page, items: [...current.items, ...page.items.filter((item) => !known.has(item.id))] };
      });
    } catch (error) {
      if (activeKey.current === key) setMoreError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setLoadingMore(false);
    }
  };
  return { ...state, loadMore, loadingMore, moreError };
}
