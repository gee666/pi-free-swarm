interface ActiveRun {
  stop(): Promise<void>;
}
const runs = new Map<ActiveRun, object | undefined>();

export function registerRun(run: ActiveRun, owner?: object): void {
  runs.set(run, owner);
}
export function unregisterRun(run: ActiveRun): void {
  runs.delete(run);
}

export async function stopOwnedRuns(owner: object): Promise<void> {
  await Promise.all([...runs].filter(([, current]) => current === owner).map(([run]) => run.stop()));
}

/** Process shutdown joins every local run, including partially admitted runs. */
export async function stopAllRuns(): Promise<void> {
  await Promise.all([...runs.keys()].map((run) => run.stop()));
}
