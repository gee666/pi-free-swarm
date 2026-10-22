interface ActiveRun {
  stop(): Promise<void>;
}
const runs = new Set<ActiveRun>();

export function registerRun(run: ActiveRun): void {
  runs.add(run);
}
export function unregisterRun(run: ActiveRun): void {
  runs.delete(run);
}

/** Session shutdown joins every local run, including partially admitted runs. */
export async function stopAllRuns(): Promise<void> {
  await Promise.all([...runs].map((run) => run.stop()));
}
