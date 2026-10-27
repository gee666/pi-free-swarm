import type { SwarmListItem } from "../api-types.js";
import { getSwarm } from "../store/swarm-queries.js";
import { readBudget } from "./budget.js";
import { readProject } from "./project.js";
import type { RunEndStatus } from "./swarms.js";
import type { RunEnvironment, RunOutcome } from "./run-types.js";

export function runOutcome(
  env: RunEnvironment,
  fallback: SwarmListItem,
  run: number,
  end: RunEndStatus,
  ended: boolean,
  budgetStop: boolean,
): RunOutcome {
  const { db, clock, settings } = env;
  return {
    swarm: getSwarm(db, fallback.id, clock.now()) ?? fallback,
    run,
    end: ended ? end : "interrupted",
    outcome: ended && end === "finished" ? readProject(db, fallback.id).outcome : null,
    ...(budgetStop ? { stopReason: "budget-exhausted" as const } : {}),
    budget: readBudget(db, fallback.id, settings, clock.now()),
  };
}
