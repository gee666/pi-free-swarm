import { resolveModelAssignments } from "../model-allocation.js";
import type { WorkerAssignment } from "../run-configuration.js";
import type { ConfigurationChange } from "../runtime-configuration.js";
import { pickAgentNames } from "../names.js";
import type { ModelSelection } from "../runtime-types.js";
import type { RunEnvironment } from "./run-types.js";

type AssignmentEnvironment = Pick<RunEnvironment, "settings" | "launch" | "availableModels">;
export type RosterChange = Exclude<ConfigurationChange, { type: "raiseBudget" }>;

function key(model: ModelSelection): string {
  return JSON.stringify([model.provider, model.modelId, model.thinkingLevel]);
}

/** New slots fill weighted target deficits without moving an existing worker to another model. */
export function planAddedWorkerSlots(
  env: AssignmentEnvironment,
  current: readonly WorkerAssignment[],
  names: readonly string[],
): WorkerAssignment[] {
  const identities = new Set(current.map((worker) => worker.name.toLowerCase()));
  for (const name of names) {
    if (!name.trim() || identities.has(name.toLowerCase()))
      throw new Error(`Worker identity is already used or invalid: ${name}`);
    identities.add(name.toLowerCase());
  }
  if (names.length === 0) return [];
  const desired = resolveModelAssignments(
    current.length + names.length,
    env.settings.models,
    env.launch.model,
    env.availableModels ?? [],
  );
  const groups = new Map<string, { model: ModelSelection; deficit: number }>();
  for (const model of desired) {
    const id = key(model);
    const group = groups.get(id);
    if (group) group.deficit++;
    else groups.set(id, { model, deficit: 1 });
  }
  for (const worker of current) {
    const group = groups.get(key(worker));
    if (group) group.deficit--;
  }
  return names.map((name) => {
    let selected: { model: ModelSelection; deficit: number } | undefined;
    for (const group of groups.values()) {
      if (!selected || group.deficit > selected.deficit) selected = group;
    }
    if (!selected || selected.deficit <= 0) throw new Error("No model capacity available for the new worker slot");
    selected.deficit--;
    return { name, ...selected.model };
  });
}

/** Plans durable slot identities before the owner applies any database or process effects. */
export function planWorkerRosterChange(
  env: AssignmentEnvironment,
  current: readonly WorkerAssignment[],
  change: RosterChange,
  historicalNames: readonly string[],
  random: () => number = Math.random,
): WorkerAssignment[] {
  const excluded = [...historicalNames, ...current.map((worker) => worker.name)];
  if (change.type === "addAgents") {
    if (!Number.isSafeInteger(change.count) || change.count < 1)
      throw new Error("count must be a positive safe integer");
    if (current.length + change.count > env.settings.maxAgents) {
      throw new Error(
        `Adding ${change.count} workers exceeds this run's maxAgents (${env.settings.maxAgents}); increase the limit before a new run or resume`,
      );
    }
    const names = pickAgentNames(change.count, random, excluded);
    return [...current.map((worker) => ({ ...worker })), ...planAddedWorkerSlots(env, current, names)];
  }
  const target = current.find((worker) => worker.name.toLowerCase() === change.name.toLowerCase());
  if (!target) throw new Error(`Worker ${change.name} is not in the current active roster`);
  if (change.type === "removeAgent") {
    if (current.length <= 1) throw new Error("Cannot remove the last active worker; use Stop instead");
    return current.filter((worker) => worker !== target).map((worker) => ({ ...worker }));
  }
  const [name] = pickAgentNames(1, random, excluded);
  if (!name) throw new Error("No fresh worker identity remains for replacement");
  return current.map((worker) => (worker === target ? replacementWorkerSlot(name, worker) : { ...worker }));
}

/** A fresh context changes identity, not the retiring worker's effective model configuration. */
export function replacementWorkerSlot(name: string, retiring: WorkerAssignment): WorkerAssignment {
  if (!name.trim() || name.toLowerCase() === retiring.name.toLowerCase()) {
    throw new Error("A replacement worker requires a fresh name");
  }
  return {
    name,
    provider: retiring.provider,
    modelId: retiring.modelId,
    thinkingLevel: retiring.thinkingLevel,
  };
}
