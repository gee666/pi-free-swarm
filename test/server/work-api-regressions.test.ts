import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { TaskDetailResponse, TasksResponse } from "../../src/api-types.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { requestTaskReview, startTask } from "../../src/broker/task-transitions.js";
import { getJson } from "./helpers.js";
import { action, createHttpCriterion, createHttpTask, workBoard } from "./work-helpers.js";

test("invalid optional search configuration degrades at real worker tool and HTTP boundaries", async (t) => {
  const board = await workBoard();
  t.after(() => board.close());
  const criterion = await createHttpCriterion(board);
  await createHttpTask(board, criterion.id);
  writeFileSync(path.join(board.temp.db.dataDir, "settings.json"), JSON.stringify({ search: { timeoutMs: "broken" } }));
  const tools = createAgentToolHandlers({
    getDb: () => board.temp.db,
    swarmId: board.swarm.id,
    run: 1,
    agentName: "Maria",
  });
  const output = await tools.tasksSearch({ query: "HTTP" });
  assert.match(JSON.stringify(output), /Build HTTP/);
  assert.match(JSON.stringify(output), /search degraded: settings failed:.*timeoutMs/);
  for (const route of ["tasks", "criteria", "posts", "skills"]) {
    const response = await getJson<TasksResponse>(board.url(`/${route}?query=HTTP`));
    assert.equal(response.status, 200);
    assert.equal(response.body.mode, "bm25");
    assert.match(response.body.notes.join(), /search degraded: settings failed:.*timeoutMs/);
  }
});

test("User contributions use attachments and task detail exposes shared handoff targets and timeline reviewers", async (t) => {
  const board = await workBoard();
  t.after(() => board.close());
  const criterion = await createHttpCriterion(board);
  const contribution = "😀漢字\n".repeat(150) + "original tail";
  const task = await createHttpTask(board, criterion.id, { criteria: [{ criterionId: criterion.id, contribution }] });
  const detail = await getJson<TaskDetailResponse>(board.url(`/tasks/${task.id}`));
  const stored = detail.body.criteria[0]?.contribution ?? "";
  const relative = /\[full text: ([^\]]+)\]/.exec(stored)?.[1];
  assert.ok(relative);
  assert.equal(readFileSync(path.resolve(board.temp.cwd, relative), "utf8"), contribution);
  assert.ok(stored.startsWith("😀漢字\n"));
  await action(board, task.id, "claim");
  for (const [name, status, retiredAt] of [
    ["Maria", "idle", null],
    ["John", "crashed", null],
    ["Stopped", "stopped", null],
    ["Retired", "idle", Date.now()],
  ] satisfies [string, string, number | null][]) {
    board.temp.db.sql
      .prepare(
        `INSERT INTO participants(swarm_id, name, kind, status, retired_at) VALUES (?, ?, 'agent', ?, ?)
      ON CONFLICT(swarm_id, name) DO UPDATE SET status = excluded.status, retired_at = excluded.retired_at`,
      )
      .run(board.swarm.id, name, status, retiredAt);
  }
  const owned = await getJson<TaskDetailResponse>(board.url(`/tasks/${task.id}`));
  assert.deepEqual(owned.body.handoffTargets, ["Liam", "Maria"]);
  await action(board, task.id, "handoff", { to: "Maria" });
  const input = { swarmId: board.swarm.id, actor: "Maria", now: Date.now(), id: task.id };
  startTask(board.temp.db, input);
  requestTaskReview(board.temp.db, { ...input, evidence: "Tests passed" });
  const review = await getJson<TaskDetailResponse>(board.url(`/tasks/${task.id}`));
  assert.deepEqual(review.body.handoffTargets, ["Liam"]);
  assert.equal(review.body.evidence?.body, "");
  assert.equal(review.body.evidence?.reviewer, "Liam");
  assert.equal(review.body.timeline.find((event) => event.kind === "review_requested")?.reviewer, "Liam");
  const tools = createAgentToolHandlers({
    getDb: () => board.temp.db,
    swarmId: board.swarm.id,
    run: 1,
    agentName: "Maria",
  });
  assert.match(tools.tasksGet({ id: task.id }), /reviewer/);
});
