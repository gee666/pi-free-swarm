import type { RunOptions, RunOutcome } from "./run-types.js";

interface ActiveRun {
  readonly dbPath: string;
  readonly swarmId: number;
  stop(): Promise<void>;
  wait(options: RunOptions): Promise<RunOutcome>;
}
type StoppableRun = Pick<ActiveRun, "stop">;
const runs = new Map<StoppableRun, object | undefined>();

export function registerRun(run: StoppableRun, owner?: object): void {
  runs.set(run, owner);
}
export function unregisterRun(run: StoppableRun): void {
  runs.delete(run);
}

export function findActiveRun(dbPath: string, swarmId: number): ActiveRun | undefined {
  return [...runs.keys()].find(
    (run): run is ActiveRun =>
      "dbPath" in run &&
      run.dbPath === dbPath &&
      "swarmId" in run &&
      run.swarmId === swarmId &&
      "wait" in run &&
      typeof run.wait === "function",
  );
}

export async function stopOwnedRuns(owner: object): Promise<void> {
  await Promise.all([...runs].filter(([, current]) => current === owner).map(([run]) => run.stop()));
}

/** Process shutdown joins every local run, including partially admitted runs. */
export async function stopAllRuns(): Promise<void> {
  await Promise.all([...runs.keys()].map((run) => run.stop()));
}
