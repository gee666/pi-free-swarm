import { useCallback, useEffect, useState, type DependencyList } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  /** True while a request is in flight; `data` keeps the previous result meanwhile. */
  loading: boolean;
  /** Fetch again, e.g. after an SSE change event or a reconnect. */
  reload: () => void;
  /** Patch the loaded data locally, e.g. to apply an SSE event without a refetch. */
  update: (updater: (current: T | undefined) => T | undefined) => void;
}

interface Snapshot<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
}

/** Runs `load` whenever `deps` change, aborting the previous request. */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({ data: undefined, error: undefined, loading: true });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setSnapshot((current) => ({ ...current, loading: true, error: undefined }));
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setSnapshot({ data, error: undefined, loading: false });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const failure = error instanceof Error ? error : new Error(String(error));
        setSnapshot((current) => ({ ...current, error: failure, loading: false }));
      },
    );
    return () => controller.abort();
    // `load` is a fresh closure every render; callers list what it depends on in `deps`.
  }, [...deps, generation]);

  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  const update = useCallback(
    (updater: (current: T | undefined) => T | undefined) =>
      setSnapshot((current) => ({ ...current, data: updater(current.data) })),
    [],
  );
  return { ...snapshot, reload, update };
}
