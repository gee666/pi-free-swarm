import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
  ApiErrorBody,
  CriteriaResponse,
  CriterionDetailResponse,
  CriterionRecord,
  CriterionBlocker,
  TaskDetailResponse,
  TaskRecord,
} from "../../src/api-types.js";
import { voteCriterion } from "../../src/broker/votes.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { postJson, getJson } from "./helpers.js";
import { action, createHttpCriterion, createHttpTask, workBoard, type WorkBoard } from "./work-helpers.js";

let board: WorkBoard;
beforeEach(async () => {
  board = await workBoard();
});
afterEach(() => board.close());

describe("criteria writes", () => {
  it("creates, revision-checks edits, archives and restores as User", async () => {
    const criterion = await createHttpCriterion(board);
    assert.equal(criterion.author, "User");
    const path = `/criteria/${criterion.id}`;
    const edited = await postJson<CriterionRecord>(board.url(`${path}/edit`), {
      expectedRevision: criterion.revision,
      fields: { title: "Read and write work" },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.revision, criterion.revision + 1);
    const conflict = await postJson<ApiErrorBody>(board.url(`${path}/edit`), {
      expectedRevision: criterion.revision,
      fields: { body: "Stale overwrite" },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.currentRevision, edited.body.revision);
    assert.equal((await postJson(board.url(`${path}/edit`), { fields: { title: "No revision" } })).status, 400);
    const archived = await postJson<CriterionRecord>(board.url(`${path}/archive`), {});
    assert.equal(archived.status, 200);
    assert.notEqual(archived.body.archivedAt, null);
    const hidden = await getJson<CriteriaResponse>(board.url("/criteria?group=HTTP"));
    assert.equal(hidden.body.items.length, 0);
    const history = await getJson<CriteriaResponse>(board.url("/criteria?group=HTTP&includeArchived=true"));
    assert.equal(history.body.items[0].id, criterion.id);
    const restored = await postJson<CriterionRecord>(board.url(`${path}/restore`), {});
    assert.equal(restored.status, 200);
    assert.equal(restored.body.archivedAt, null);
  });

  it("records a blocker, counts owner and independent agreement, and allows User to reject it", async () => {
    const criterion = await createHttpCriterion(board);
    const task = await createHttpTask(board, criterion.id, { claim: true });
    await action(board, task.id, "handoff", { to: "Maria" });
    const path = `/criteria/${criterion.id}`;
    const blocker = await postJson<CriterionBlocker>(board.url(`${path}/block`), {
      reason: "No access",
      missing: "Credentials",
      attempted: "Checked environment",
      unblock: "Grant access",
      expectedRevision: 0,
    });
    assert.equal(blocker.status, 200);
    const early = await postJson(board.url(`${path}/blocker-decision`), { decision: "reject" });
    assert.equal(early.status, 400);
    voteCriterion(board.temp.db, {
      swarmId: board.swarm.id,
      actor: "Maria",
      now: Date.now(),
      criterionId: criterion.id,
      verdict: "blocked",
      reason: "Owner agrees",
    });
    assert.equal(
      (await postJson(board.url(`${path}/vote`), { verdict: "blocked", reason: "Independent agrees" })).status,
      200,
    );
    const detail = await getJson<CriterionDetailResponse>(board.url(path));
    assert.equal(detail.body.status, "blocked");
    assert.deepEqual(detail.body.agreement, { current: 2, required: 2, label: "2/2" });
    assert.deepEqual(
      detail.body.votes.map((vote) => [vote.voter, vote.role, vote.stale]),
      [
        ["Maria", "owner", false],
        ["User", "independent", false],
      ],
    );
    const decision = await postJson<CriterionBlocker>(board.url(`${path}/blocker-decision`), {
      decision: "reject",
      expectedRevision: blocker.body.revision,
    });
    assert.equal(decision.status, 200);
    assert.equal(decision.body.rejectedRevision, blocker.body.revision);
    const rejected = await getJson<CriterionDetailResponse>(board.url(path));
    assert.equal(rejected.body.status, "incomplete");
    assert.ok(rejected.body.votes.every((vote) => vote.stale));
    assert.equal((await postJson(board.url(`${path}/blocker-decision`), { decision: "approve" })).status, 400);
    const stale = await postJson<ApiErrorBody>(board.url(`${path}/block`), {
      reason: "Changed",
      missing: "Access",
      attempted: "Asked",
      unblock: "Reply",
      expectedRevision: 0,
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.currentRevision, blocker.body.revision);
  });

  it("accepts unlimited User bodies and caps Unicode titles at 100 points", async () => {
    const long = "Detailed evidence\n".repeat(10_000);
    const criterion = await createHttpCriterion(board, {
      title: "🚀".repeat(100),
      body: long,
      verification: long,
      source: long,
    });
    for (const field of [criterion.body, criterion.verification, criterion.source])
      assert.match(field, /full text: .*\.md/);
    const tooLong = await postJson(board.url("/criteria"), {
      group: "HTTP",
      title: "🚀".repeat(101),
      body: "Body",
      verification: "Check",
      source: "",
    });
    assert.equal(tooLong.status, 400);
    const task = await createHttpTask(board, criterion.id, { body: long, claim: true });
    assert.match(task.body, /full text:/);
    const vote = await postJson<{ reason: string }>(board.url(`/criteria/${criterion.id}/vote`), {
      verdict: "incomplete",
      reason: long,
    });
    assert.equal(vote.status, 200);
    assert.match(vote.body.reason, /full text:/);
    const blocker = await postJson<CriterionBlocker>(board.url(`/criteria/${criterion.id}/block`), {
      reason: long,
      missing: long,
      attempted: long,
      unblock: long,
    });
    assert.equal(blocker.status, 200);
    for (const field of [blocker.body.reason, blocker.body.missing, blocker.body.attempted, blocker.body.unblock])
      assert.match(field, /full text:/);
    await action(board, task.id, "start");
    const review = await action(board, task.id, "request-review", { evidence: long });
    assert.equal(review.status, "review");
    const detail = await getJson<TaskDetailResponse>(board.url(`/tasks/${task.id}`));
    assert.match(detail.body.latestEvidence ?? "", /full text:/);
  });
});

describe("task writes", () => {
  it("runs every action through the domain and exposes evidence and review history", async () => {
    const criterion = await createHttpCriterion(board);
    const task = await createHttpTask(board, criterion.id);
    assert.equal(task.owner, null);
    const claimed = await action(board, task.id, "claim");
    assert.equal(claimed.owner, "User");
    const edited = await action(board, task.id, "edit", {
      expectedRevision: claimed.revision,
      fields: { title: "HTTP with SSE", dependsOn: [] },
    });
    const stale = await postJson<ApiErrorBody>(board.url(`/tasks/${task.id}/edit`), {
      expectedRevision: claimed.revision,
      fields: { title: "Old edit" },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.currentRevision, edited.revision);
    await action(board, task.id, "release");
    await action(board, task.id, "claim");
    await action(board, task.id, "handoff", { to: "Maria" });
    await action(board, task.id, "start");
    const requested = await action(board, task.id, "request-review", { evidence: "test/server passes" });
    assert.equal(requested.status, "review");
    const changes = await action(board, task.id, "review", { verdict: "changes", reason: "Cover conflicts" });
    assert.equal(changes.status, "in_progress");
    await action(board, task.id, "request-review", { evidence: "Conflict tests pass" });
    const accepted = await action(board, task.id, "review", { verdict: "accept", reason: "Verified" });
    assert.equal(accepted.acceptedBy, "User");
    const detail = await getJson<TaskDetailResponse>(board.url(`/tasks/${task.id}`));
    assert.equal(detail.body.latestEvidence, "Conflict tests pass");
    assert.equal(detail.body.reviewerVerdict?.kind, "review_accepted");
    assert.equal(detail.body.evidence?.actor, "User");
    assert.ok(detail.body.validActions.includes("reopen"));
    const reopened = await action(board, task.id, "reopen", { reason: "Regression found" });
    assert.equal(reopened.status, "in_progress");
  });

  it("rejects missing criteria, malformed fields, invalid transitions and User self-review", async () => {
    const criterion = await createHttpCriterion(board);
    assert.equal((await postJson(board.url("/tasks"), { title: "No links", body: "Body", criteria: [] })).status, 400);
    assert.equal(
      (await postJson(board.url("/tasks"), { title: "Wrong links", body: "Body", criteria: [null] })).status,
      400,
    );
    const task = await createHttpTask(board, criterion.id, { claim: true });
    assert.equal(
      (await postJson(board.url(`/tasks/${task.id}/review`), { verdict: "accept", reason: "Too early" })).status,
      400,
    );
    await action(board, task.id, "start");
    await action(board, task.id, "request-review", { evidence: "Checks passed" });
    const self = await postJson(board.url(`/tasks/${task.id}/review`), { verdict: "accept", reason: "My own work" });
    assert.equal(self.status, 400);
    const detail = await getJson<TaskDetailResponse>(board.url(`/tasks/${task.id}`));
    assert.ok(!detail.body.validActions.includes("review"));
  });
});

describe("User identity", () => {
  it("refuses supplied identity", async () => {
    for (const path of ["/criteria/1/restore", "/criteria/1/blocker-decision"]) {
      const spoof = await postJson(board.url(path), { actor: "Maria", decision: "reject" });
      assert.equal(spoof.status, 400);
    }
  });

  it("returns 404 for missing and cross-swarm work, not validation or internal errors", async () => {
    for (const path of ["/criteria/999999", "/tasks/999999"])
      assert.equal((await getJson(board.url(path))).status, 404);
    assert.equal((await postJson(board.url("/tasks/999999/claim"), {})).status, 404);
    const foreign = seedSwarm(board.temp.db, { name: "Other swarm", now: Date.now() });
    const criterion = await createHttpCriterion(board);
    const task = await createHttpTask(board, criterion.id);
    const foreignUrl = `${board.base}/api/swarms/${foreign.id}`;
    assert.equal((await getJson(`${foreignUrl}/criteria/${criterion.id}`)).status, 404);
    assert.equal((await getJson(`${foreignUrl}/tasks/${task.id}`)).status, 404);
    const result = await postJson<TaskRecord>(`${foreignUrl}/tasks`, {
      title: "Foreign",
      body: "Body",
      criteria: [{ criterionId: criterion.id, contribution: "Wrong swarm" }],
    });
    assert.equal(result.status, 404);
  });
});
