import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createTask } from "../../src/broker/tasks.js";
import { activeWorkerNames } from "../../src/store/active-roster.js";
import { appendConfigurationRevision } from "../../src/store/configuration-revisions.js";
import { listCriteria } from "../../src/store/criteria.js";
import { openSwarmDb } from "../../src/store/db.js";
import { getRunConfiguration } from "../../src/store/run-configuration.js";
import { getRuntimeConfiguration } from "../../src/store/runtime-configuration.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { configurationOwner } from "./configuration-fixture.js";
import { agentStatus, createRunFixture, isAlive, waitFor } from "./run-fixture.js";

async function heldWorker() {
  const run = createRunFixture(SCENARIOS.settle);
  const release = path.join(run.cwd, "initial-turn-release");
  writeFileSync(
    run.fake.env.FAKE_PI_SCENARIO,
    JSON.stringify({
      agents: { Watcher: {} },
      spawns: [{ runs: [[{ type: "waitForFile", file: release }, { type: "reply" }]] }, SCENARIOS.settle],
    }),
  );
  const owner = await configurationOwner(run, 1);
  const [name] = activeWorkerNames(run.db, owner.swarmId);
  const tools = createAgentToolHandlers({ getDb: () => run.db, swarmId: owner.swarmId, run: 1, agentName: name });
  const latest = () => getRuntimeConfiguration(run.db, owner.swarmId, Date.now())?.requests[0];
  return { run, owner, name, tools, latest };
}

test(
  "a never-idled worker retires through the live owner and launches its replacement",
  { timeout: 30_000 },
  async () => {
    const { run, owner, name, tools, latest } = await heldWorker();
    const { swarmId } = owner;
    try {
      await waitFor(() => agentStatus(run.db, swarmId, name) === "working", "first working turn");
      const firstIdle = () =>
        run.db.sql.prepare("SELECT first_idle_at FROM participants WHERE swarm_id = ? AND name = ?").get(swarmId, name)
          ?.first_idle_at;
      assert.equal(firstIdle(), null);
      const spawned = run.fake.log().find((entry) => entry.fake === "spawn" && entry.agent === name);
      assert.ok(spawned && typeof spawned.pid === "number");
      tools.retire({ handoff: "First turn complete; preserve this handoff." });
      const request = latest();
      assert.ok(request);
      await owner.waitApplied(request.id);
      assert.equal(agentStatus(run.db, swarmId, name), "retired");
      assert.equal(firstIdle(), null, "retirement does not require or fabricate an idle turn");
      assert.equal(isAlive(spawned.pid), false);
      const [replacement] = activeWorkerNames(run.db, swarmId);
      assert.notEqual(replacement, name);
      await waitFor(
        () => run.fake.log().some((entry) => entry.type === "prompt" && entry.agent === replacement),
        "replacement receives its first prompt",
      );
      assert.ok(
        run.fake
          .log()
          .some(
            (entry) =>
              entry.type === "prompt" &&
              entry.agent === replacement &&
              String(entry.message).includes("First turn complete; preserve this handoff."),
          ),
      );
    } finally {
      await owner.close();
      run.cleanup();
    }
  },
);

test(
  "new obligations reject queued retirement and durably notify the live requester",
  { timeout: 30_000 },
  async () => {
    const { run, owner, name, tools, latest } = await heldWorker();
    const { swarmId } = owner;
    try {
      await waitFor(() => agentStatus(run.db, swarmId, name) === "working", "first working turn");
      tools.retire({ handoff: "No obligations when submitted." });
      const request = latest();
      assert.ok(request);
      const [criterion] = listCriteria(run.db, swarmId);
      assert.ok(criterion);
      const tasks = ["claimed", "in_progress", "review"].map((status) => {
        const task = createTask(run.db, {
          swarmId,
          actor: name,
          now: Date.now(),
          title: `New ${status} obligation`,
          body: "Assigned after retirement was queued.",
          criteria: [{ criterionId: criterion.id, contribution: "Remaining work" }],
          claim: true,
        });
        run.db.sql.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, task.id);
        return task.id;
      });
      await owner.advance(50);
      await waitFor(() => latest()?.status === "rejected", "retirement rejected after obligation revalidation");
      assert.equal(
        latest()?.error,
        `Finish, release or hand off ${tasks.map((id) => `#${id}`).join(", ")} before retiring.`,
      );
      assert.deepEqual(activeWorkerNames(run.db, swarmId), [name]);
      assert.equal(getRunConfiguration(run.db, swarmId)?.revision ?? 0, 0);
      assert.equal(run.fake.log().filter((entry) => entry.fake === "spawn" && entry.agent !== "Watcher").length, 1);

      const reader = openSwarmDb(run.db.path, { create: false });
      let noticeId: number;
      try {
        const notice = reader.sql
          .prepare(
            "SELECT m.id, m.body, m.sender, r.name FROM messages m JOIN message_recipients r ON r.message_id = m.id WHERE m.swarm_id = ? AND m.body LIKE ?",
          )
          .get(swarmId, `Retirement request #${request.id} was rejected:%`);
        assert.ok(notice && typeof notice.id === "number");
        noticeId = notice.id;
        assert.equal(notice.sender, "System");
        assert.equal(notice.name, name);
        assert.match(String(notice.body), /must not assume you retired/);
        assert.match(String(notice.body), /Retry retirement only if you are still active/);
        for (const id of tasks) assert.ok(String(notice.body).includes(`#${id}`));
      } finally {
        reader.close();
      }
      await owner.advance(50);
      await waitFor(
        () =>
          run.fake
            .log()
            .some(
              (entry) =>
                entry.type === "prompt" &&
                entry.agent === name &&
                String(entry.message).includes(`Retirement request #${request.id} was rejected`),
            ),
        "requester receives the rejection rather than only a generic idle reminder",
      );
      await owner.advance(50);
      assert.equal(
        run.db.sql
          .prepare("SELECT COUNT(*) AS n FROM messages WHERE swarm_id = ? AND body LIKE ?")
          .get(swarmId, `Retirement request #${request.id} was rejected:%`)?.n,
        1,
        "later control polls do not duplicate the rejection notice",
      );
      assert.ok(run.db.sql.prepare("SELECT id FROM messages WHERE id = ?").get(noticeId));
    } finally {
      await owner.close();
      run.cleanup();
    }
  },
);

test(
  "stale retirement revisions remain fenced and notify the requester before an explicit retry",
  { timeout: 30_000 },
  async () => {
    const { run, owner, name, tools, latest } = await heldWorker();
    const { swarmId } = owner;
    try {
      await waitFor(() => agentStatus(run.db, swarmId, name) === "working", "first working turn");
      tools.retire({ handoff: "Retirement against the original configuration." });
      const request = latest();
      assert.ok(request);
      const saved = getRunConfiguration(run.db, swarmId);
      assert.ok(saved);
      appendConfigurationRevision(run.db, swarmId, 1, saved.effective, saved.revision ?? 0, Date.now());
      await owner.advance(50);
      await waitFor(() => latest()?.status === "rejected", "stale retirement rejected");
      assert.match(latest()?.error ?? "", /Configuration changed before this control started/);
      assert.deepEqual(activeWorkerNames(run.db, swarmId), [name]);
      assert.ok(
        run.db.sql
          .prepare(
            "SELECT m.id FROM messages m JOIN message_recipients r ON r.message_id = m.id WHERE m.swarm_id = ? AND r.name = ? AND m.body LIKE ?",
          )
          .get(swarmId, name, `Retirement request #${request.id} was rejected:%`),
      );
      tools.retire({ handoff: "Explicit retry after confirming rejection and the active roster." });
      const retry = latest();
      assert.ok(retry && retry.id !== request.id);
      assert.equal(retry.expectedRevision, 1);
      await owner.waitApplied(retry.id);
      assert.equal(agentStatus(run.db, swarmId, name), "retired");
    } finally {
      await owner.close();
      run.cleanup();
    }
  },
);
