import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { sendMessage } from "../../src/broker/messages.js";
import { startSwarm } from "../../src/broker/swarm-run.js";
import { REVIVE_PROMPT_HEADER } from "../../src/constants.js";
import { listPosts } from "../../src/store/wall-queries.js";
import { SCENARIOS, type FakePiScenario } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  agentStatus,
  createRunFixture,
  FAST,
  newestSwarmId,
  promptTexts,
  recipientStatus,
  reviveCount,
  spawnsOf,
  waitFor,
  type RunFixture,
} from "./run-fixture.js";

let fixture: RunFixture | undefined;
afterEach(() => fixture?.cleanup());

const QUICK_WATCHDOG = { startupTimeoutMs: 10_000, idleTimeoutMs: 300, startupRetries: 0 };

function startOne(scenario: FakePiScenario, timings = {}) {
  const run = createRunFixture(scenario, { timings });
  fixture = run;
  const outcome = startSwarm(run.env, { name: "crashy", taskPrompt: "Work.", agentAmount: 1 }, {});
  const swarmId = newestSwarmId(run.db);
  const [name] = agentNames(run.db, swarmId);
  return { run, db: run.db, outcome, swarmId, name };
}

function crashedPosts(run: RunFixture, swarmId: number) {
  return listPosts(run.db, swarmId, { count: 100, offset: 0 }).posts.filter((post) => post.author === "Main");
}

describe("crash recovery", () => {
  it(
    "revives a crashed agent on its session and re-sends delivered-not-read messages",
    { timeout: 20_000 },
    async () => {
      const crashMidTool: FakePiScenario = {
        runs: [
          [
            { type: "tool", ms: 800 },
            { type: "exit", code: 3, stderr: "boom" },
          ],
        ],
      };
      const { run, db, outcome, swarmId, name } = startOne({ spawns: [crashMidTool, SCENARIOS.settle] });
      await waitFor(() => agentStatus(db, swarmId, name) === "working", "agent working");
      const id = sendMessage(db, swarmId, "User", [name], "queued before the crash", Date.now()).id;
      await waitFor(() => recipientStatus(db, id, name) === "delivered", "steer queued in pi");
      await waitFor(() => recipientStatus(db, id, name) === "read", "read after the revive", 10_000);

      assert.equal((await outcome).end, "finished");
      assert.equal(reviveCount(db, swarmId, name), 1);
      const spawns = spawnsOf(run.fake);
      assert.equal(spawns.length, 2);
      assert.equal(spawns[1].session, spawns[0].session, "same session file");
      const revive = promptTexts(run.fake).find((text) => text.startsWith(REVIVE_PROMPT_HEADER));
      assert.ok(revive?.includes(`[swarm message #${id}]`), "the unread message is re-sent in the revive prompt");
      assert.deepEqual(crashedPosts(run, swarmId), []);
    },
  );

  it("revives after a watchdog inactivity kill", { timeout: 20_000 }, async () => {
    const scenario = { spawns: [SCENARIOS.inactivityStall, SCENARIOS.settle] };
    const { run, db, outcome, swarmId, name } = startOne(scenario, { watchdog: QUICK_WATCHDOG });
    assert.equal((await outcome).end, "finished");
    assert.equal(reviveCount(db, swarmId, name), 1);
    assert.equal(spawnsOf(run.fake).length, 2);
    assert.ok(promptTexts(run.fake).some((text) => text.startsWith(REVIVE_PROMPT_HEADER)));
    const signals = run.fake.log().filter((record) => record.fake === "signal");
    assert.equal(signals.length, 2, "SIGTERM for the stalled process, then for the revived one at the finish");
  });

  it("never kills a long tool call or a long idle", { timeout: 20_000 }, async () => {
    const { run, db, outcome, swarmId, name } = startOne(SCENARIOS.longTool(1_200), {
      watchdog: QUICK_WATCHDOG,
      completionGraceMs: 1_000,
    });
    await waitFor(() => agentStatus(db, swarmId, name) === "idle", "tool finished", 10_000);
    assert.equal((await outcome).end, "finished", "a second of idle is three watchdog windows");
    assert.equal(reviveCount(db, swarmId, name), 0);
    assert.equal(spawnsOf(run.fake).length, 1);
  });

  it("stops reviving after the budget, posts on the wall as Main and still finishes", { timeout: 20_000 }, async () => {
    const { run, db, outcome, swarmId, name } = startOne(SCENARIOS.crash, { completionGraceMs: 1_000 });
    await waitFor(() => crashedPosts(run, swarmId).length > 0, "revives exhausted", 10_000);
    // Completion no longer waits for messages to an agent that is gone for good.
    const id = sendMessage(db, swarmId, "User", [name], "you will not read this", Date.now()).id;
    assert.equal(recipientStatus(db, id, name), "pending");
    const result = await outcome;
    assert.equal(result.end, "finished");
    assert.equal(agentStatus(db, swarmId, name), "crashed");
    assert.equal(reviveCount(db, swarmId, name), FAST.reviveBackoffMs.length);
    assert.equal(spawnsOf(run.fake).length, FAST.reviveBackoffMs.length + 1);
    assert.deepEqual(
      crashedPosts(run, swarmId).map((post) => [post.title, post.text]),
      [[`${name} crashed`, `${name} crashed and was not revived`]],
    );
    assert.equal(recipientStatus(db, id, name), "undeliverable");
  });

  it("never revives a fatal extension-load failure and tells the user", { timeout: 20_000 }, async () => {
    const { run, db, outcome, swarmId, name } = startOne(SCENARIOS.extensionLoadFailure);
    assert.equal((await outcome).end, "finished");
    assert.equal(agentStatus(db, swarmId, name), "crashed");
    assert.equal(reviveCount(db, swarmId, name), 0);
    assert.equal(spawnsOf(run.fake).length, 1);
    assert.equal(run.notes.length, 1);
    assert.match(run.notes[0], /could not start\. Error: Failed to load extension "\/x\/index\.ts"/);
    assert.equal(crashedPosts(run, swarmId).length, 1);
  });
});
