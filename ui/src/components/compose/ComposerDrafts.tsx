import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from "react";

interface Draft {
  text: string;
}

const EMPTY_DRAFT: Draft = { text: "" };

function createDraftStore() {
  const drafts = new Map<string, Draft>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    get: (key: string) => drafts.get(key) ?? EMPTY_DRAFT,
    set: (key: string, text: string) => {
      if ((drafts.get(key)?.text ?? "") === text) return;
      if (text) drafts.set(key, { text });
      else drafts.delete(key);
      for (const listener of listeners.get(key) ?? []) listener();
    },
    subscribe: (key: string, listener: () => void) => {
      const subscribers = listeners.get(key) ?? new Set<() => void>();
      subscribers.add(listener);
      listeners.set(key, subscribers);
      return () => {
        subscribers.delete(listener);
        if (subscribers.size === 0) listeners.delete(key);
      };
    },
  };
}

const DraftContext = createContext<ReturnType<typeof createDraftStore> | null>(null);

/** Lives above routed tabs, so navigation does not discard unsent User text. */
export function ComposerDraftsProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createDraftStore);
  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>;
}

export function useComposerDraft(key: string | undefined) {
  const store = useContext(DraftContext);
  if (!store) throw new Error("useComposerDraft requires ComposerDraftsProvider");
  const subscribe = useCallback(
    (listener: () => void) => (key === undefined ? () => {} : store.subscribe(key, listener)),
    [store, key],
  );
  const getSnapshot = useCallback(() => (key === undefined ? EMPTY_DRAFT : store.get(key)), [store, key]);
  const draft = useSyncExternalStore(subscribe, getSnapshot);
  const setText = useCallback(
    (text: string) => {
      if (key !== undefined) store.set(key, text);
    },
    [store, key],
  );
  // A late successful response must not erase edits made after submission, even on another tab.
  const clearSubmitted = useCallback(() => {
    if (key !== undefined && store.get(key) === draft) store.set(key, "");
  }, [store, key, draft]);
  return [draft.text, setText, clearSubmitted] as const;
}
