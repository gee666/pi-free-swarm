import type { SwarmListItem } from "../api-types.js";
import { listAgentSessions } from "../store/swarm-queries.js";
import { getPendingReplacementHandoff } from "../store/replacement-handoff.js";
import { assertBudgetPricing } from "./budget.js";
import { readReplacementHandoff } from "./replacement-handoff.js";
import { runAgentFactory, type RunAgentServices } from "./run-agent-factory.js";
import { configureRun } from "./run-configuration.js";
import type { RunEnvironment, RunTimings } from "./run-types.js";
import type { RunAgent } from "./run-agent.js";

export function prepareRunRoster(
  env: RunEnvironment,
  swarm: SwarmListItem,
  run: number,
  timings: RunTimings,
  services: RunAgentServices,
  restart = false,
) {
  const sessions = listAgentSessions(env.db, swarm.id, { activeOnly: true });
  const assignments = configureRun(
    env,
    swarm.id,
    run,
    sessions.map(({ name }) => name),
    timings,
  );
  assertBudgetPricing(env, assignments, swarm.id);
  const create = runAgentFactory(env, swarm, run, timings, services, restart);
  const agents = new Map<string, RunAgent>();
  for (const session of sessions) {
    const pending = getPendingReplacementHandoff(env.db, swarm.id, session.name);
    const handoff = pending ? readReplacementHandoff(env.db, swarm.id, pending) : undefined;
    agents.set(session.name, create(session, assignments.get(session.name), handoff));
  }
  return { agents, create };
}
