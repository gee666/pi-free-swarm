import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { useLoadMore, type PageSource } from "./useLoadMore";

interface Page {
  items: { id: number; text: string }[];
  next: number | null;
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Uninitialized deferred");
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function catalogue() {
  let items = [1, 2, 3].map((id) => ({ id, text: `Item ${id}` }));
  const calls: (number | undefined)[] = [];
  const source: PageSource<Page> = {
    fetch: async (_signal, current) => {
      calls.push(current?.next ?? undefined);
      const offset = current?.next ?? 0;
      return { items: items.slice(offset, offset + 1), next: offset + 1 < items.length ? offset + 1 : null };
    },
    hasMore: (page) => page.next !== null,
    merge: (current, page) => {
      const known = new Set(current.items.map((item) => item.id));
      return { ...page, items: [...current.items, ...page.items.filter((item) => !known.has(item.id))] };
    },
  };
  return {
    source,
    calls,
    replace: (next: typeof items) => {
      items = next;
    },
  };
}
const ids = (data: Page | undefined) => data?.items.map((item) => item.id);

it("refreshes all opened pages with fresh values and cursors, including after reconnect", async () => {
  const server = catalogue();
  const view = renderHook(({ opened }) => useLoadMore(server.source, "tasks", [opened]), {
    initialProps: { opened: 1 },
  });
  await waitFor(() => expect(ids(view.result.current.data)).toEqual([1]));
  act(() => view.result.current.loadMore());
  await waitFor(() => expect(ids(view.result.current.data)).toEqual([1, 2]));
  server.replace([
    { id: 4, text: "Inserted" },
    { id: 1, text: "Updated" },
    { id: 3, text: "Item 3" },
  ]);
  act(() => view.result.current.reload());
  await waitFor(() => expect(ids(view.result.current.data)).toEqual([4, 1]));
  expect(view.result.current.data?.items[1].text).toBe("Updated");
  expect(server.calls.slice(-2)).toEqual([undefined, 1]);
  view.rerender({ opened: 2 });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(ids(view.result.current.data)).toEqual([4, 1]);
  expect(server.calls.slice(-2)).toEqual([undefined, 1]);
});

it.each(["older-first", "refresh-first"])(
  "keeps requested depth when refresh and Load more overlap: %s",
  async (order) => {
    const server = catalogue();
    const fetchPage = server.source.fetch;
    const older = deferred<Page>();
    const refresh = deferred<Page>();
    let requests = 0;
    server.source.fetch = (signal, current) => {
      requests++;
      if (requests === 2) return older.promise;
      if (requests === 3) return refresh.promise;
      return fetchPage(signal, current);
    };
    const view = renderHook(() => useLoadMore(server.source, "wall", []));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    act(() => view.result.current.loadMore());
    act(() => view.result.current.reload());
    await waitFor(() => expect(requests).toBe(3));
    const oldPage = { items: [{ id: 2, text: "Stale page" }], next: null };
    const newPage = { items: [{ id: 1, text: "Fresh page" }], next: 1 };
    if (order === "older-first") {
      await act(async () => {
        older.resolve(oldPage);
        await older.promise;
      });
      await act(async () => {
        refresh.resolve(newPage);
        await refresh.promise;
      });
    } else {
      await act(async () => {
        refresh.resolve(newPage);
        await refresh.promise;
      });
      await act(async () => {
        older.resolve(oldPage);
        await older.promise;
      });
    }
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(ids(view.result.current.data)).toEqual([1, 2]);
    expect(view.result.current.data?.items[1].text).toBe("Item 2");
    expect(view.result.current.hasMore).toBe(true);
  },
);

it("discards old-filter pages and resets depth without leaking their errors", async () => {
  const server = catalogue();
  const fetchPage = server.source.fetch;
  const pending = deferred<Page>();
  server.source.fetch = (signal, current) => (current ? pending.promise : fetchPage(signal, current));
  const view = renderHook(({ key }) => useLoadMore(server.source, key, []), { initialProps: { key: "all" } });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  act(() => view.result.current.loadMore());
  view.rerender({ key: "filtered" });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  await act(async () => {
    pending.resolve({ items: [{ id: 99, text: "Old query" }], next: null });
    await pending.promise;
  });
  expect(ids(view.result.current.data)).toEqual([1]);
  expect(view.result.current.loadingMore).toBe(false);
  act(() => view.result.current.reload());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(ids(view.result.current.data)).toEqual([1]);
});

it("keeps opened pages on failure and retries without requesting an extra page", async () => {
  const server = catalogue();
  const fetchPage = server.source.fetch;
  let fail = true;
  server.source.fetch = (signal, current) => {
    if (current && fail) return Promise.reject(new Error("Unavailable"));
    return fetchPage(signal, current);
  };
  const view = renderHook(() => useLoadMore(server.source, "criteria", []));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  act(() => view.result.current.loadMore());
  await waitFor(() => expect(view.result.current.loadMoreError?.message).toBe("Unavailable"));
  expect(ids(view.result.current.data)).toEqual([1]);
  fail = false;
  act(() => view.result.current.loadMore());
  await waitFor(() => expect(ids(view.result.current.data)).toEqual([1, 2]));
  act(() => view.result.current.reload());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(ids(view.result.current.data)).toEqual([1, 2]);
});

it("replays live updates received while a paginated snapshot is in flight", async () => {
  const server = catalogue();
  const fetchPage = server.source.fetch;
  const pending = deferred<Page>();
  const view = renderHook(() => useLoadMore(server.source, "wall", []));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  act(() => view.result.current.loadMore());
  await waitFor(() => expect(ids(view.result.current.data)).toEqual([1, 2]));
  server.source.fetch = (signal, current) => (current ? fetchPage(signal, current) : pending.promise);
  act(() => view.result.current.reload());
  act(() =>
    view.result.current.update(
      (current) =>
        current && {
          ...current,
          items: current.items.map((item) => (item.id === 1 ? { ...item, text: "Live" } : item)),
        },
    ),
  );
  await act(async () => {
    pending.resolve({ items: [{ id: 1, text: "Snapshot" }], next: 1 });
    await pending.promise;
  });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(ids(view.result.current.data)).toEqual([1, 2]);
  expect(view.result.current.data?.items[0].text).toBe("Live");
});
