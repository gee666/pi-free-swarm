import { useState } from "react";
import type { AsyncState } from "./useAsync";

export interface PageSource<T> {
  /** Items loaded so far; the next page starts at this offset. */
  loaded: (data: T) => number;
  total: (data: T) => number;
  fetch: (offset: number) => Promise<T>;
  /** Appends an older page; items that moved because of live inserts must be skipped. */
  merge: (current: T, page: T) => T;
}

export interface LoadMore {
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: Error | undefined;
  loadMore: () => void;
}

/** "Show more" for an offset-paginated `useAsync` list. */
export function useLoadMore<T>(state: AsyncState<T>, source: PageSource<T>): LoadMore {
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<Error>();
  const { data, update } = state;

  const loadMore = () => {
    if (data === undefined || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(undefined);
    source
      .fetch(source.loaded(data))
      .then((page) => update((current) => current && source.merge(current, page)))
      .catch((error: Error) => setLoadMoreError(error))
      .finally(() => setLoadingMore(false));
  };

  const hasMore = data !== undefined && source.loaded(data) < source.total(data);
  return { hasMore, loadingMore, loadMoreError, loadMore };
}
