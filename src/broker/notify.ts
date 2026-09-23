// In-process only: lets the runner deliver messages written in its own process without waiting for the
// next delivery poll. Writes from other processes are still picked up by the poll.

type Listener = (swarmId: number) => void;

const listeners = new Set<Listener>();

export function onLocalMessage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called after the commit that stored a pending recipient. */
export function notifyLocalMessage(swarmId: number): void {
  for (const listener of listeners) listener(swarmId);
}
