// Stats tab: usage, time and activity per agent and per swarm. Open spans count up to `now`.
import type { AgentStats, StatsResponse, UsageCostBreakdown, UsageCostComponent, UsageTotals } from "../api-types.js";
import type { SwarmDb } from "./db.js";
import { agentStatusOf, int, real, text, type Row } from "./rows.js";

function categorySums(column: string): string {
  const value = `CASE WHEN cost_reported IS NULL AND cost <= 0 AND ${column} = 0 THEN NULL ELSE ${column} END`;
  return `SUM(${value}) AS ${column}, COUNT(${value}) AS ${column}_records`;
}

const CATEGORY_SUMS = ["cost_input", "cost_output", "cost_cache_read", "cost_cache_write"].map(categorySums).join(", ");
const USAGE_SUMS = `
  COALESCE(SUM(input), 0) AS input, COALESCE(SUM(output), 0) AS output,
  COALESCE(SUM(cache_read), 0) AS cache_read, COALESCE(SUM(cache_write), 0) AS cache_write,
  COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(kind = 'message'), 0) AS turns,
  COUNT(*) AS cost_records, ${CATEGORY_SUMS}`;

function costComponent(row: Row, column: string): UsageCostComponent {
  const knownRecords = int(row, `${column}_records`);
  return { usd: knownRecords === 0 ? null : real(row, column), knownRecords };
}

function costBreakdownOf(row: Row): UsageCostBreakdown | undefined {
  const input = costComponent(row, "cost_input");
  const output = costComponent(row, "cost_output");
  const cacheRead = costComponent(row, "cost_cache_read");
  const cacheWrite = costComponent(row, "cost_cache_write");
  if ([input, output, cacheRead, cacheWrite].every((value) => value.knownRecords === 0)) return undefined;
  return { records: int(row, "cost_records"), input, output, cacheRead, cacheWrite };
}

function usageOf(row: Row | undefined): UsageTotals {
  if (row === undefined) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
  const costBreakdown = costBreakdownOf(row);
  return {
    ...(costBreakdown ? { costBreakdown } : {}),
    input: int(row, "input"),
    output: int(row, "output"),
    cacheRead: int(row, "cache_read"),
    cacheWrite: int(row, "cache_write"),
    cost: real(row, "cost"),
    turns: int(row, "turns"),
  };
}

/** Every native usage kind contributes tokens/cost; turns remain assistant-only. */
export function agentUsageTotals(db: SwarmDb, swarmId: number, agent: string): UsageTotals {
  return usageOf(
    db.sql.prepare(`SELECT ${USAGE_SUMS} FROM usage WHERE swarm_id = ? AND agent = ?`).get(swarmId, agent),
  );
}

function scalar(db: SwarmDb, query: string, ...params: (number | string)[]): number {
  const row = db.sql.prepare(query).get(...params);
  return row === undefined ? 0 : int(row, "n");
}

function agentStats(db: SwarmDb, swarmId: number, row: Row, now: number): AgentStats {
  const name = text(row, "name");
  return {
    name,
    status: agentStatusOf(row),
    ...agentUsageTotals(db, swarmId, name),
    activeTimeMs: scalar(
      db,
      "SELECT COALESCE(SUM(COALESCE(ended_at, ?) - started_at), 0) AS n FROM agent_runs WHERE swarm_id = ? AND agent = ?",
      now,
      swarmId,
      name,
    ),
    reviveCount: int(row, "revive_count"),
    posts: scalar(db, "SELECT COUNT(*) AS n FROM posts WHERE swarm_id = ? AND author = ?", swarmId, name),
    comments: scalar(db, "SELECT COUNT(*) AS n FROM comments WHERE swarm_id = ? AND author = ?", swarmId, name),
    messagesSent: scalar(db, "SELECT COUNT(*) AS n FROM messages WHERE swarm_id = ? AND sender = ?", swarmId, name),
  };
}

/** Agents in launch order; `null` when the swarm does not exist. */
export function getStats(db: SwarmDb, swarmId: number, now: number): StatsResponse | null {
  const swarm = db.sql.prepare("SELECT run_count FROM swarms WHERE id = ?").get(swarmId);
  if (swarm === undefined) return null;
  const agents = db.sql
    .prepare("SELECT * FROM participants WHERE swarm_id = ? AND kind = 'agent' ORDER BY launch_order")
    .all(swarmId)
    .map((row) => agentStats(db, swarmId, row, now));
  const usage = usageOf(db.sql.prepare(`SELECT ${USAGE_SUMS} FROM usage WHERE swarm_id = ?`).get(swarmId));
  return {
    swarmId,
    computedAt: now,
    agents,
    totals: {
      ...usage,
      wallTimeMs: scalar(
        db,
        "SELECT COALESCE(SUM(COALESCE(ended_at, ?) - started_at), 0) AS n FROM swarm_runs WHERE swarm_id = ?",
        now,
        swarmId,
      ),
      activeTimeMs: agents.reduce((sum, agent) => sum + agent.activeTimeMs, 0),
      runCount: int(swarm, "run_count"),
      posts: scalar(db, "SELECT COUNT(*) AS n FROM posts WHERE swarm_id = ?", swarmId),
      comments: scalar(db, "SELECT COUNT(*) AS n FROM comments WHERE swarm_id = ?", swarmId),
      messages: scalar(db, "SELECT COUNT(*) AS n FROM messages WHERE swarm_id = ?", swarmId),
    },
  };
}
