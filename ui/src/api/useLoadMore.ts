import { useEffect, useMemo, useState, type DependencyList } from "react";
import { useAsync, type AsyncState } from "./useAsync";

export interface PageSource<T> {
  fetch: (signal: AbortSignal, current?: T) => Promise<T>;
  hasMore: (data: T) => boolean;
  merge: (current: T, page: T) => T;
}

export interface LoadMore {
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: Error | undefined;
  loadMore: () => void;
}

/** Refresh every requested page, but start over when the list or its filters change. */
export function useLoadMore<T>(
  source: PageSource<T>,
  key: string,
  refresh: DependencyList,
  enabled = true,
): AsyncState<T> & LoadMore {
  const scope = useMemo(() => ({ depth: 1, busy: false, controller: new AbortController() }), [key]);
  const [more, setMore] = useState<{ scope: typeof scope; loading: boolean; error?: Error }>();
  useEffect(() => {
    scope.controller = new AbortController();
    return () => scope.controller.abort();
  }, [scope]);
  const state = useAsync(
    async (signal) => {
      // The refresh replaces the whole window, so an older request must not append stale cursors to it.
      scope.controller.abort();
      scope.controller = new AbortController();
      scope.busy = false;
      setMore({ scope, loading: false });
      let value: T = await source.fetch(signal);
      let pages = 1;
      while (pages < scope.depth && source.hasMore(value)) {
        value = source.merge(value, await source.fetch(signal, value));
        pages++;
      }
      return { scope, value, pages };
    },
    [scope, ...refresh],
    enabled,
  );
  const snapshot = state.data?.scope === scope ? state.data : undefined;
  const loadMore = () => {
    if (!enabled || state.loading || !snapshot || scope.busy || !source.hasMore(snapshot.value)) return;
    const { signal } = scope.controller;
    scope.busy = true;
    scope.depth = Math.max(scope.depth, snapshot.pages + 1);
    setMore({ scope, loading: true });
    source
      .fetch(signal, snapshot.value)
      .then(
        (page) => {
          if (signal.aborted) return;
          state.update((latest) =>
            latest?.scope !== scope
              ? latest
              : {
                  scope,
                  value: source.merge(latest.value, page),
                  pages: Math.max(latest.pages, snapshot.pages + 1),
                },
          );
          setMore({ scope, loading: false });
        },
        (error: unknown) => {
          if (signal.aborted) return;
          setMore({ scope, loading: false, error: error instanceof Error ? error : new Error(String(error)) });
        },
      )
      .finally(() => {
        if (!signal.aborted) scope.busy = false;
      });
  };
  return {
    data: snapshot?.value,
    error: state.error,
    loading: state.loading,
    reload: state.reload,
    update: (updater) =>
      state.update((current) => {
        if (current?.scope !== scope) return current;
        const value = updater(current.value);
        return value === undefined ? undefined : { ...current, value };
      }),
    hasMore: snapshot !== undefined && source.hasMore(snapshot.value),
    loadingMore: more?.scope === scope && more.loading,
    loadMoreError: more?.scope === scope ? more.error : undefined,
    loadMore,
  };
}
