// Runner side of agent rows: status (with working spans), live activity, usage and revives.
import type { AgentActivity, AgentRunEndReason, ParticipantStatus } from "../api-types.js";
import type { UsageSample } from "../runtime-types.js";
import type { SwarmDb } from "../store/db.js";
import { insertEvent } from "../store/events.js";
import { agentStatusOf, int, text, textOrNull } from "../store/rows.js";
import { agentUsageTotals } from "../store/stats-queries.js";
import { emitParticipantUpdated, emitSwarmUpdated } from "./emit.js";
import { BrokerError } from "./errors.js";

const RUN_OF_SWARM = "(SELECT run_count FROM swarms WHERE id = ?)";

function agentRow(
  db: SwarmDb,
  swarmId: number,
  name: string,
): { name: string; status: ParticipantStatus; activity: string | null } {
  const row = db.sql
    .prepare("SELECT name, status, activity FROM participants WHERE swarm_id = ? AND name = ? AND kind = 'agent'")
    .get(swarmId, name);
  if (row === undefined) throw new BrokerError("validation", `Unknown agent: ${name}.`);
  return { name: text(row, "name"), status: agentStatusOf(row), activity: textOrNull(row, "activity") };
}

function spanEndReason(next: ParticipantStatus): AgentRunEndReason {
  if (next === "idle") return "settled";
  return next === "crashed" ? "crashed" : "stopped";
}

/**
 * No-op when unchanged. Entering `working` opens a work span for the current run, leaving it closes the
 * span; activity is cleared unless the agent is working.
 */
export function setAgentStatus(
  db: SwarmDb,
  swarmId: number,
  name: string,
  status: ParticipantStatus,
  now: number,
): void {
  db.write(() => {
    const agent = agentRow(db, swarmId, name);
    if (agent.status === status) return;
    db.sql
      .prepare(
        "UPDATE participants SET status = ?, activity = CASE WHEN ? = 'working' THEN activity END WHERE swarm_id = ? AND name = ?",
      )
      .run(status, status, swarmId, agent.name);
    if (agent.status === "working") {
      db.sql
        .prepare("UPDATE agent_runs SET ended_at = ?, reason = ? WHERE swarm_id = ? AND agent = ? AND ended_at IS NULL")
        .run(now, spanEndReason(status), swarmId, agent.name);
    }
    if (status === "working") {
      db.sql
        .prepare(`INSERT INTO agent_runs (swarm_id, agent, run, started_at) VALUES (?, ?, ${RUN_OF_SWARM}, ?)`)
        .run(swarmId, agent.name, swarmId, now);
    }
    emitParticipantUpdated(db, swarmId, agent.name, now);
    // The picker shows how many agents work; it only listens to swarm.updated.
    if (agent.status === "working" || status === "working") emitSwarmUpdated(db, swarmId, now);
  });
}

export function setAgentActivity(
  db: SwarmDb,
  swarmId: number,
  name: string,
  activity: AgentActivity | null,
  now: number,
): void {
  db.write(() => {
    const agent = agentRow(db, swarmId, name);
    const encoded = activity === null ? null : JSON.stringify(activity);
    if (agent.activity === encoded) return;
    db.sql
      .prepare("UPDATE participants SET activity = ? WHERE swarm_id = ? AND name = ?")
      .run(encoded, swarmId, agent.name);
    emitParticipantUpdated(db, swarmId, agent.name, now);
  });
}

/** Emits the agent's cumulative totals; compactions add tokens and cost but not turns. */
export function recordUsage(db: SwarmDb, swarmId: number, name: string, sample: UsageSample, now: number): void {
  db.write(() => {
    const agent = agentRow(db, swarmId, name).name;
    db.sql
      .prepare(
        `INSERT INTO usage (swarm_id, agent, run, kind, input, output, cache_read, cache_write, cost, model, created_at)
         VALUES (?, ?, ${RUN_OF_SWARM}, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        swarmId,
        agent,
        swarmId,
        sample.kind,
        sample.input,
        sample.output,
        sample.cacheRead,
        sample.cacheWrite,
        sample.cost,
        sample.model,
        now,
      );
    insertEvent(db, swarmId, "usage.updated", { agent, usage: agentUsageTotals(db, swarmId, agent) }, now);
  });
}

/** Returns the new count. The next status change publishes it. */
export function incrementReviveCount(db: SwarmDb, swarmId: number, name: string): number {
  return db.write(() => {
    const agent = agentRow(db, swarmId, name).name;
    db.sql
      .prepare("UPDATE participants SET revive_count = revive_count + 1 WHERE swarm_id = ? AND name = ?")
      .run(swarmId, agent);
    const row = db.sql
      .prepare("SELECT revive_count FROM participants WHERE swarm_id = ? AND name = ?")
      .get(swarmId, agent);
    return row === undefined ? 0 : int(row, "revive_count");
  });
}
