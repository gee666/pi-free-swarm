import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import type { CriteriaGroupsResponse, DashboardResponse } from "../../src/api-types.js";
import { voteCriterion } from "../../src/broker/votes.js";
import { getJson, postJson } from "./helpers.js";
import { action, createHttpCriterion, createHttpTask, workBoard, type WorkBoard } from "./work-helpers.js";

let board: WorkBoard;
beforeEach(async () => {
  board = await workBoard();
});
afterEach(() => board.close());

it("shares dashboard group coverage and counts every derived status with optional archived criteria", async () => {
  const satisfied = await createHttpCriterion(board, { group: "Coverage", title: "Satisfied" });
  const blocked = await createHttpCriterion(board, { group: "Coverage", title: "Blocked" });
  const incomplete = await createHttpCriterion(board, { group: "Coverage", title: "Incomplete" });
  await createHttpCriterion(board, { group: "Coverage", title: "Unlinked" });
  const archived = await createHttpCriterion(board, { group: "Coverage", title: "Archived" });
  await createHttpTask(board, incomplete.id);
  const accepted = await createHttpTask(board, satisfied.id, { claim: true });
  await action(board, accepted.id, "handoff", { to: "Maria" });
  await action(board, accepted.id, "start");
  await action(board, accepted.id, "request-review", { evidence: "Tests pass" });
  await action(board, accepted.id, "review", { verdict: "accept", reason: "Verified" });
  voteCriterion(board.temp.db, {
    swarmId: board.swarm.id,
    actor: "Maria",
    now: Date.now(),
    criterionId: satisfied.id,
    verdict: "satisfied",
    reason: "Owner verified",
  });
  assert.equal(
    (
      await postJson(board.url(`/criteria/${satisfied.id}/vote`), {
        verdict: "satisfied",
        reason: "Independently verified",
      })
    ).status,
    200,
  );
  const blockedTask = await createHttpTask(board, blocked.id, { claim: true });
  await action(board, blockedTask.id, "handoff", { to: "Maria" });
  assert.equal(
    (
      await postJson(board.url(`/criteria/${blocked.id}/block`), {
        reason: "No access",
        missing: "Credentials",
        attempted: "Checked environment",
        unblock: "Grant access",
      })
    ).status,
    200,
  );
  voteCriterion(board.temp.db, {
    swarmId: board.swarm.id,
    actor: "Maria",
    now: Date.now(),
    criterionId: blocked.id,
    verdict: "blocked",
    reason: "Owner agrees",
  });
  assert.equal(
    (await postJson(board.url(`/criteria/${blocked.id}/vote`), { verdict: "blocked", reason: "Independent agrees" }))
      .status,
    200,
  );
  assert.equal((await postJson(board.url(`/criteria/${archived.id}/archive`), {})).status, 200);

  const groups = await getJson<CriteriaGroupsResponse>(board.url("/criteria/groups"));
  assert.equal(groups.status, 200);
  assert.deepEqual(
    groups.body.groups.find((group) => group.group === "Coverage"),
    {
      group: "Coverage",
      satisfied: 1,
      blocked: 1,
      incomplete: 1,
      unlinked: 1,
      total: 4,
    },
  );
  const dashboard = await getJson<DashboardResponse>(board.url("/dashboard"));
  assert.deepEqual(groups.body.groups, dashboard.body.criteriaCoverage);
  const history = await getJson<CriteriaGroupsResponse>(board.url("/criteria/groups?includeArchived=true"));
  assert.deepEqual(
    history.body.groups.find((group) => group.group === "Coverage"),
    {
      group: "Coverage",
      satisfied: 1,
      blocked: 1,
      incomplete: 1,
      unlinked: 2,
      total: 5,
    },
  );
  assert.equal((await getJson(board.url("/criteria/groups?includeArchived=invalid"))).status, 400);
});
