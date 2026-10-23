import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  /** True while a request is in flight; `data` keeps the previous result meanwhile. */
  loading: boolean;
  /** Fetch again, e.g. after an SSE change event or a reconnect. */
  reload: () => void;
  /** Pure patch, also replayed over an in-flight snapshot to preserve concurrent SSE changes. */
  update: (updater: (current: T | undefined) => T | undefined) => void;
}

interface Snapshot<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
}

/** When enabled, runs `load` as `deps` change and aborts the previous request. */
export function useAsync<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  enabled = true,
): AsyncState<T> {
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({ data: undefined, error: undefined, loading: true });
  const [generation, setGeneration] = useState(0);
  const pending = useRef<{ updates: ((current: T | undefined) => T | undefined)[] } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const request: { updates: ((current: T | undefined) => T | undefined)[] } = { updates: [] };
    pending.current = request;
    setSnapshot((current) => ({ ...current, loading: true, error: undefined }));
    load(controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        // A snapshot may predate events received during its fetch. Apply those same
        // pure patches to the response instead of overwriting the newer live state.
        const current = request.updates.reduce<T | undefined>((value, update) => update(value), data);
        pending.current = null;
        setSnapshot({ data: current, error: undefined, loading: false });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        pending.current = null;
        const failure = error instanceof Error ? error : new Error(String(error));
        setSnapshot((current) => ({ ...current, error: failure, loading: false }));
      },
    );
    return () => {
      controller.abort();
      if (pending.current === request) pending.current = null;
    };
    // `load` is a fresh closure every render; callers list what it depends on in `deps`.
  }, [enabled, ...deps, generation]);

  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  const update = useCallback((updater: (current: T | undefined) => T | undefined) => {
    pending.current?.updates.push(updater);
    setSnapshot((current) => ({ ...current, data: updater(current.data) }));
  }, []);
  return { ...snapshot, reload, update };
}
