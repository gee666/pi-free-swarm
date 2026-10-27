import assert from "node:assert/strict";
import { it, mock } from "node:test";
import type { ParticipantStatus } from "../../src/api-types.js";
import { recordUsage, setAgentStatus } from "../../src/broker/agent-state.js";
import { sendMessage } from "../../src/broker/messages.js";
import { readRunProgress, type RunProgress } from "../../src/broker/run-progress.js";
import { beginResume, endRun, markSwarmRunning } from "../../src/broker/swarms.js";
import { createPost } from "../../src/broker/wall.js";
import { USER_NAME, WATCHER_NAME } from "../../src/constants.js";
import type { SwarmDb } from "../../src/store/db.js";
import { unreadCounts } from "../../src/store/message-queries.js";
import { getStats } from "../../src/store/stats-queries.js";
import { getSwarm, listParticipants } from "../../src/store/swarm-queries.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

// Deliberately retain the rich-reader reference to prove scalar projection parity and query-work reduction.
function reference(db: SwarmDb, id: number, now: number, boardUrl: string | null): RunProgress {
  const swarm = getSwarm(db, id, now);
  const stats = getStats(db, id, now);
  assert.ok(swarm && stats);
  const agents: Record<ParticipantStatus, number> = {
    pending: 0,
    starting: 0,
    working: 0,
    idle: 0,
    crashed: 0,
    stopped: 0,
    retired: 0,
  };
  for (const participant of listParticipants(db, id)) {
    if (participant.kind === "agent" && participant.name !== WATCHER_NAME) agents[participant.status]++;
  }
  const totals = stats.totals;
  return {
    swarmId: id,
    swarmName: swarm.name,
    run: swarm.runCount,
    status: swarm.status,
    agents,
    posts: totals.posts,
    messages: totals.messages,
    unreadForUser: unreadCounts(db, id, [USER_NAME])[USER_NAME] ?? 0,
    elapsedMs: Math.max(0, (swarm.finishedAt ?? now) - (swarm.startedAt ?? now)),
    cost: totals.cost,
    tokens: totals.input + totals.output + totals.cacheRead + totals.cacheWrite,
    boardUrl,
  };
}

function observed<T>(db: SwarmDb, action: () => T) {
  const queries: string[] = [];
  const original = db.sql.prepare.bind(db.sql);
  const tracked = mock.method(db.sql, "prepare", (query: string) => {
    queries.push(query);
    return original(query);
  });
  try {
    return { result: action(), queries };
  } finally {
    tracked.mock.restore();
  }
}

it("preserves cumulative archived/Watcher usage, current-run elapsed, status counts and User unread across resume", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const swarm = seedSwarm(temp.db);
  const other = seedSwarm(temp.db);
  recordUsage(
    temp.db,
    swarm.id,
    "Maria",
    { kind: "message", input: 20, output: 10, cacheRead: 30, cacheWrite: 40, cost: 1.25, model: null },
    T0 + 1,
  );
  recordUsage(
    temp.db,
    swarm.id,
    WATCHER_NAME,
    { kind: "compaction", input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.05, model: null },
    T0 + 2,
  );
  recordUsage(
    temp.db,
    swarm.id,
    "John",
    { kind: "message", input: 5, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.2, model: null },
    T0 + 3,
  );
  recordUsage(
    temp.db,
    other.id,
    "Maria",
    { kind: "message", input: 1000000, output: 1, cacheRead: 2, cacheWrite: 3, cost: 999, model: null },
    T0,
  );
  createPost(temp.db, swarm.id, "Maria", { title: "result", text: "evidence" }, T0 + 3);
  createPost(temp.db, other.id, "Maria", { title: "unrelated", text: "private" }, T0);
  const delivered = sendMessage(temp.db, {
    swarmId: swarm.id,
    from: "Maria",
    to: USER_NAME,
    text: "delivered",
    now: T0 + 4,
  });
  const pending = sendMessage(temp.db, {
    swarmId: swarm.id,
    from: "John",
    to: USER_NAME,
    text: "pending",
    now: T0 + 4,
  });
  const read = sendMessage(temp.db, { swarmId: swarm.id, from: "Liam", to: USER_NAME, text: "read", now: T0 + 4 });
  temp.db.sql
    .prepare("UPDATE message_recipients SET status = 'pending', delivered_at = NULL WHERE message_id = ?")
    .run(pending.id);
  temp.db.sql
    .prepare("UPDATE message_recipients SET status = 'read', read_at = ? WHERE message_id = ?")
    .run(T0 + 5, read.id);
  assert.equal(delivered.recipients[0]?.status, "delivered");
  endRun(temp.db, swarm.id, process.pid, "stopped", T0 + 10, 1);
  temp.db.sql
    .prepare("UPDATE participants SET retired_at = ?, status = 'stopped' WHERE swarm_id = ? AND name = 'Maria'")
    .run(T0 + 11, swarm.id);
  beginResume(temp.db, swarm.id, process.pid, T0 + 1000);
  recordUsage(
    temp.db,
    swarm.id,
    "John",
    { kind: "message", input: 2, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.3, model: null },
    T0 + 1000,
  );
  setAgentStatus(temp.db, swarm.id, "John", "working", T0 + 1001);
  setAgentStatus(temp.db, swarm.id, "Liam", "crashed", T0 + 1002);
  setAgentStatus(temp.db, swarm.id, WATCHER_NAME, "working", T0 + 1003);
  markSwarmRunning(temp.db, swarm.id, process.pid, T0 + 1003, 2);
  const actual = readRunProgress(temp.db, swarm.id, T0 + 1500, "http://board.test");
  assert.deepEqual(actual, reference(temp.db, swarm.id, T0 + 1500, "http://board.test"));
  assert.equal(actual.run, 2);
  assert.equal(actual.elapsedMs, 500);
  assert.equal(actual.tokens, 117);
  assert.equal(actual.unreadForUser, 2);
  assert.equal(actual.agents.retired, 1);
  assert.equal(actual.agents.working, 1, "Watcher work is excluded from worker counts, not usage");
});

it("retains stale/dead-owner and terminal status semantics, clamps elapsed and rejects missing swarms", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const swarm = seedSwarm(temp.db);
  temp.db.sql.prepare("UPDATE swarms SET status = 'running', runner_heartbeat_at = 0 WHERE id = ?").run(swarm.id);
  assert.deepEqual(readRunProgress(temp.db, swarm.id, T0, null), reference(temp.db, swarm.id, T0, null));
  assert.equal(readRunProgress(temp.db, swarm.id, T0, null).status, "interrupted");
  temp.db.sql
    .prepare("UPDATE swarms SET runner_pid = ?, runner_heartbeat_at = ? WHERE id = ?")
    .run(2 ** 30, T0, swarm.id);
  assert.deepEqual(readRunProgress(temp.db, swarm.id, T0, null), reference(temp.db, swarm.id, T0, null));
  for (const status of ["finished", "stopped", "interrupted"]) {
    temp.db.sql
      .prepare("UPDATE swarms SET status = ?, finished_at = ?, started_at = ? WHERE id = ?")
      .run(status, T0 - 1, T0, swarm.id);
    const actual = readRunProgress(temp.db, swarm.id, T0, null);
    assert.deepEqual(actual, reference(temp.db, swarm.id, T0, null));
    assert.equal(actual.elapsedMs, 0);
  }
  assert.throws(() => readRunProgress(temp.db, swarm.id + 1000, T0, null), /not found/);
});

it("keeps progress query work fixed and avoids rich metadata/history reads as archived roster grows", (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const swarm = seedSwarm(temp.db);
  const before = observed(temp.db, () => readRunProgress(temp.db, swarm.id, T0, null));
  temp.db.write(() => {
    const insert = temp.db.sql.prepare(
      "INSERT INTO participants (swarm_id,name,kind,status,session_file,launch_order,retired_at) VALUES (?,?,'agent','stopped',?,?,?)",
    );
    for (let i = 0; i < 300; i++) insert.run(swarm.id, `Archive${i}`, `sessions/archived-${i}.jsonl`, i + 100, T0);
  });
  const after = observed(temp.db, () => readRunProgress(temp.db, swarm.id, T0, null));
  const rich = observed(temp.db, () => reference(temp.db, swarm.id, T0, null));
  assert.deepEqual(after.result, rich.result);
  assert.equal(after.result.agents.retired, 300);
  assert.equal(before.queries.length, 4);
  assert.equal(after.queries.length, before.queries.length);
  assert.ok(rich.queries.length > after.queries.length);
  assert.equal(
    after.queries.some((query) =>
      /run_configurations|configuration_requests|configuration_revisions|agent_runs|\bcomments\b|session_file|last_activity_at|revive_count|task_prompt/i.test(
        query,
      ),
    ),
    false,
  );
  assert.ok(after.queries.some((query) => /FROM participants[\s\S]*GROUP BY/i.test(query)));
  console.log(`progress query-work: 300 retired rows, scalar=${after.queries.length}, rich=${rich.queries.length}`);
});
