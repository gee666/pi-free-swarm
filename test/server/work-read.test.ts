import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
  CriteriaGroupsResponse,
  CriteriaResponse,
  CriterionDetailResponse,
  DashboardResponse,
  TaskDetailResponse,
  TasksResponse,
} from "../../src/api-types.js";
import { sendMessage } from "../../src/broker/messages.js";
import { voteCriterion } from "../../src/broker/votes.js";
import { readProject, updateProjectIntent } from "../../src/broker/project.js";
import { listTasks } from "../../src/store/tasks.js";
import { listCriteria } from "../../src/store/criteria.js";
import { getJson, postJson } from "./helpers.js";
import { action, createHttpCriterion, createHttpTask, workBoard, type WorkBoard } from "./work-helpers.js";

let board: WorkBoard;
beforeEach(async () => {
  board = await workBoard();
});
afterEach(() => board.close());

describe("work searches", () => {
  it("filters and pages criteria, preserving ranking notes and archive visibility", async () => {
    const first = await createHttpCriterion(board, { title: "Target HTTP" });
    const second = await createHttpCriterion(board, { title: "Other HTTP" });
    const task = await createHttpTask(board, first.id, { claim: true });
    const page = await getJson<CriteriaResponse>(board.url("/criteria?group=HTTP&status[]=unlinked&limit=1"));
    assert.equal(page.status, 200);
    assert.equal(page.body.items[0].id, second.id);
    assert.equal(page.body.items[0].linkedTaskCount, 0);
    assert.equal(page.body.mode, "filter");
    const linked = await getJson<CriteriaResponse>(
      board.url(`/criteria?taskId=${task.id}&author=User&status=incomplete&needsMyVote=true`),
    );
    assert.deepEqual(
      linked.body.items.map((item) => item.id),
      [first.id],
    );
    assert.equal(linked.body.items[0].voteProgress.label, "0/2");
    const ranked = await getJson<CriteriaResponse>(board.url("/criteria?group=HTTP&query=Target&limit=1"));
    assert.equal(ranked.body.mode, "bm25");
    assert.equal(ranked.body.items[0].id, first.id);
    assert.ok(ranked.body.nextCursor);
    const next = await getJson<CriteriaResponse>(
      board.url(`/criteria?group=HTTP&query=Target&limit=1&cursor=${ranked.body.nextCursor}`),
    );
    assert.equal(next.body.items[0].id, second.id);
    const invalid = await getJson<CriteriaResponse>(board.url("/criteria?cursor=bad"));
    assert.deepEqual(invalid.body.items, []);
    assert.ok(invalid.body.notes.length);
    const groups = await getJson<CriteriaGroupsResponse>(board.url("/criteria/groups"));
    assert.ok(groups.body.groups.some((group) => group.group === "HTTP"));
    assert.ok(groups.body.groups.some((group) => group.group === "Planning"));
    for (const query of ["status=unknown", "needsMyVote=yes", "includeArchived=1", "taskId=-1", "limit=no"])
      assert.equal((await getJson(board.url(`/criteria?${query}`))).status, 400, query);
  });

  it("filters tasks by status, owner, author, criterion and derived readiness", async () => {
    const criterion = await createHttpCriterion(board);
    const dep = await createHttpTask(board, criterion.id, { title: "Dependency" });
    const waiting = await createHttpTask(board, criterion.id, { title: "Waiting task", dependsOn: [dep.id] });
    const runnable = await getJson<TasksResponse>(
      board.url(`/tasks?owner=unowned&runnable=true&criterionId=${criterion.id}&author=User&status=new`),
    );
    assert.deepEqual(
      runnable.body.items.map((task) => task.id),
      [dep.id],
    );
    const blocked = await getJson<TasksResponse>(board.url(`/tasks?criterionId=${criterion.id}&waiting=true`));
    assert.deepEqual(
      blocked.body.items.map((task) => task.waitsOn),
      [[dep.id]],
    );
    assert.equal(blocked.body.items[0].id, waiting.id);
    await action(board, dep.id, "claim");
    const owned = await getJson<TasksResponse>(board.url(`/tasks?owner=User&status[]=claimed&deferred=false`));
    assert.equal(owned.body.items[0].id, dep.id);
    const detail = await getJson<TaskDetailResponse>(board.url(`/tasks/${waiting.id}?limit=1`));
    assert.equal(detail.body.waiting, true);
    assert.equal(detail.body.dependencies[0].status, "claimed");
    assert.equal(detail.body.criteria[0].status, "incomplete");
    assert.ok(!detail.body.validActions.includes("start"));
    const reverse = await getJson<TaskDetailResponse>(board.url(`/tasks/${dep.id}?limit=1`));
    assert.equal(reverse.body.dependents[0].id, waiting.id);
    assert.ok(reverse.body.nextAfter);
    const more = await getJson<TaskDetailResponse>(
      board.url(`/tasks/${dep.id}?after=${reverse.body.nextAfter}&limit=1`),
    );
    assert.ok(more.body.timeline[0].id > reverse.body.timeline[0].id);
    for (const query of ["status=waiting", "waiting=yes", "runnable=1", "deferred=0", "criterionId=oops", "limit=-1"])
      assert.equal((await getJson(board.url(`/tasks?${query}`))).status, 400, query);
    assert.equal((await getJson(board.url(`/tasks/${dep.id}?after=-1`))).status, 400);
  });

  it("never invokes configured helper models on HTTP searches", async () => {
    writeFileSync(
      path.join(board.temp.db.dataDir, "settings.json"),
      JSON.stringify({ helperModel: "missing/model/off" }),
    );
    await createHttpCriterion(board);
    const result = await getJson<CriteriaResponse>(board.url("/criteria?query=HTTP"));
    assert.equal(result.status, 200);
    assert.equal(result.body.mode, "bm25");
    assert.deepEqual(result.body.notes, []);
  });

  it("shows stale votes, contributions and missing voters in criterion detail", async () => {
    const criterion = await createHttpCriterion(board);
    const task = await createHttpTask(board, criterion.id, { claim: true });
    await postJson(board.url(`/criteria/${criterion.id}/vote`), { verdict: "incomplete", reason: "Not finished" });
    await action(board, task.id, "edit", { expectedRevision: task.revision, fields: { body: "Updated work" } });
    const detail = await getJson<CriterionDetailResponse>(board.url(`/criteria/${criterion.id}`));
    assert.equal(detail.body.tasks[0].contribution, "Expose the graph");
    assert.equal(detail.body.votes[0].stale, true);
    assert.equal(detail.body.votes[0].role, "owner");
    assert.deepEqual(detail.body.missingVoters, ["User", "independent"]);
  });
});

describe("dashboard", () => {
  it("persists the canonical last intent editor and exposes it in the dashboard", async () => {
    assert.equal(readProject(board.temp.db, board.swarm.id).intentUpdatedBy, null);
    const input = { swarmId: board.swarm.id, now: Date.now(), summary: "Document the user intent", path: "intent.md" };
    const first = updateProjectIntent(board.temp.db, { ...input, actor: "maria", expectedRevision: 0 });
    assert.equal(first.intentUpdatedBy, "Maria");
    assert.equal(readProject(board.temp.db, board.swarm.id).intentUpdatedBy, "Maria");
    assert.equal((await getJson<DashboardResponse>(board.url("/dashboard"))).body.project.intentUpdatedBy, "Maria");
    assert.throws(() => updateProjectIntent(board.temp.db, { ...input, actor: "User", expectedRevision: 0 }));
    assert.equal(readProject(board.temp.db, board.swarm.id).intentUpdatedBy, "Maria");
    const second = updateProjectIntent(board.temp.db, {
      ...input,
      actor: "User",
      expectedRevision: first.intentRevision,
    });
    assert.equal(second.intentUpdatedBy, "User");
    assert.equal((await getJson<DashboardResponse>(board.url("/dashboard"))).body.project.intentUpdatedBy, "User");
  });

  it("returns work gates, grouped coverage, attention, velocity, activity and run header", async () => {
    const criterion = await createHttpCriterion(board);
    const task = await createHttpTask(board, criterion.id, { claim: true });
    await action(board, task.id, "handoff", { to: "Maria" });
    await postJson(board.url(`/criteria/${criterion.id}/block`), {
      reason: "Need license",
      missing: "License",
      attempted: "Checked repository",
      unblock: "Approve purchase",
    });
    voteCriterion(board.temp.db, {
      swarmId: board.swarm.id,
      actor: "Maria",
      now: Date.now(),
      criterionId: criterion.id,
      verdict: "blocked",
      reason: "Owner agrees",
    });
    await postJson(board.url(`/criteria/${criterion.id}/vote`), { verdict: "blocked", reason: "Independent agrees" });
    sendMessage(board.temp.db, {
      swarmId: board.swarm.id,
      from: "Maria",
      to: "User",
      text: "Please decide",
      now: Date.now(),
    });
    const response = await getJson<DashboardResponse>(board.url("/dashboard"));
    assert.equal(response.status, 200);
    const data = response.body;
    assert.equal(data.header.state, "running");
    assert.equal(data.header.run, board.swarm.runCount);
    assert.equal(data.header.agentCount, board.swarm.agentAmount);
    assert.equal(data.header.startedAt, board.swarm.startedAt);
    assert.deepEqual(
      data.gates.map((gate) => gate.key),
      ["scope", "linked", "tasks", "criteria", "review"],
    );
    assert.equal(data.attention.scopeApprovalNeeded, true);
    assert.equal(data.attention.blockerDecisions[0].id, criterion.id);
    assert.equal(data.attention.unreadUserMessages, 1);
    assert.deepEqual(
      data.criteriaCoverage.find((group) => group.group === "HTTP"),
      {
        group: "HTTP",
        satisfied: 0,
        blocked: 1,
        incomplete: 0,
        unlinked: 0,
        total: 1,
      },
    );
    assert.equal(data.velocity.accepted15Minutes, 0);
    assert.equal(data.velocity.accepted60Minutes, 0);
    assert.equal(data.etaMs, null);
    assert.ok(data.project.briefPath);
    assert.ok(
      data.recentActivity.some((row) => row.targetKind === "task" && row.title === task.title && row.actor === "User"),
    );
    assert.ok(
      data.recentActivity.some((row) => row.kind === "voted" && row.targetId === criterion.id && row.actor === "Maria"),
    );
  });

  it("reports awaiting User and applies both ETA thresholds without a guessed estimate", async () => {
    const criterion = await createHttpCriterion(board);
    for (let index = 0; index < 3; index++) await createHttpTask(board, criterion.id);
    const main = listCriteria(board.temp.db, board.swarm.id).find((item) => item.group === "Main");
    assert.ok(main);
    await postJson(board.url(`/criteria/${main.id}/archive`), {});
    const tasks = listTasks(board.temp.db, board.swarm.id);
    assert.equal(tasks.length, 5);
    for (const task of tasks) {
      await action(board, task.id, "claim");
      await action(board, task.id, "handoff", { to: "Maria" });
      await action(board, task.id, "start");
      await action(board, task.id, "request-review", { evidence: "Tests pass" });
      await action(board, task.id, "review", { verdict: "accept", reason: "Verified" });
    }
    for (const item of listCriteria(board.temp.db, board.swarm.id)) {
      voteCriterion(board.temp.db, {
        swarmId: board.swarm.id,
        actor: "Maria",
        now: Date.now(),
        criterionId: item.id,
        verdict: "satisfied",
        reason: "Owner verified",
      });
      await postJson(board.url(`/criteria/${item.id}/vote`), {
        verdict: "satisfied",
        reason: "Independent verification",
      });
    }
    const fresh = await getJson<DashboardResponse>(board.url("/dashboard"));
    assert.equal(fresh.body.header.state, "awaiting_user");
    assert.equal(fresh.body.etaMs, null);
    const now = Date.now();
    board.temp.db.sql.prepare("UPDATE swarms SET started_at = ? WHERE id = ?").run(now - 31 * 60_000, board.swarm.id);
    board.temp.db.sql.prepare("UPDATE tasks SET accepted_at = ? WHERE id = ?").run(now - 20 * 60_000, tasks[0].id);
    const old = await getJson<DashboardResponse>(board.url("/dashboard"));
    assert.equal(old.body.velocity.accepted15Minutes, 4);
    assert.equal(old.body.velocity.accepted60Minutes, 5);
    assert.equal(old.body.etaMs, 0);
    board.temp.db.sql.prepare("UPDATE tasks SET accepted_at = ? WHERE id = ?").run(now - 61 * 60_000, tasks[0].id);
    assert.equal((await getJson<DashboardResponse>(board.url("/dashboard"))).body.etaMs, null);
  });

  it("does not report stopped or interrupted runs as awaiting User", async () => {
    board.temp.db.sql.prepare("UPDATE swarms SET status = 'stopped' WHERE id = ?").run(board.swarm.id);
    assert.equal((await getJson<DashboardResponse>(board.url("/dashboard"))).body.header.state, "stopped");
    board.temp.db.sql.prepare("UPDATE swarms SET status = 'interrupted' WHERE id = ?").run(board.swarm.id);
    assert.equal((await getJson<DashboardResponse>(board.url("/dashboard"))).body.header.state, "interrupted");
    board.temp.db.sql
      .prepare("UPDATE swarms SET status = 'finished', outcome = 'stopped_with_blockers' WHERE id = ?")
      .run(board.swarm.id);
    assert.equal(
      (await getJson<DashboardResponse>(board.url("/dashboard"))).body.header.state,
      "stopped_with_blockers",
    );
  });
});
