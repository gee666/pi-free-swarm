import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { sendMessage } from "../../src/broker/messages.js";
import { startSwarm } from "../../src/broker/swarm-run.js";
import { RUNNER_PID_ENV, UNDELIVERABLE_REPLY_TEXT } from "../../src/constants.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import {
  agentNames,
  agentStatus,
  createRunFixture,
  newestSwarmId,
  promptTexts,
  recipientStatus,
  spawnsOf,
  systemReplies,
  waitFor,
  type RunFixture,
} from "./run-fixture.js";

let fixture: RunFixture | undefined;
afterEach(() => fixture?.cleanup());

function readEnviron(pid: number): Map<string, string> {
  const raw = readFileSync(`/proc/${pid}/environ`, "utf8");
  return new Map(
    raw.split("\0").flatMap((entry): [string, string][] => {
      const equals = entry.indexOf("=");
      return equals > 0 ? [[entry.slice(0, equals), entry.slice(equals + 1)]] : [];
    }),
  );
}

describe("delivery during a run", () => {
  it("pending → kickoff → read, idle → wake, env, and messages after finish", { timeout: 30_000 }, async () => {
    const run = createRunFixture(SCENARIOS.settle, { staggerSeconds: 1, settingsEnv: { PROJECT_TOKEN: "s3cret" } });
    fixture = run;
    const { db } = run;
    const outcome = startSwarm(run.env, { name: "demo", taskPrompt: "Build it.", agentAmount: 2 }, {});
    const swarmId = newestSwarmId(db);
    const [first, second] = agentNames(db, swarmId);

    // The second agent is still waiting for its stagger slot: its message waits for the kickoff.
    const early = sendMessage(db, swarmId, "User", [second], "for your kickoff", Date.now()).id;
    await waitFor(() => agentStatus(db, swarmId, first) === "idle", "first agent idle");
    assert.equal(agentStatus(db, swarmId, second), "pending");
    assert.equal(recipientStatus(db, early, second), "pending");

    const [firstSpawn] = spawnsOf(run.fake);
    if (existsSync(`/proc/${firstSpawn.pid}/environ`)) {
      const environ = readEnviron(firstSpawn.pid);
      assert.equal(environ.get("PI_SWARM_ROLE"), "agent");
      assert.equal(environ.get("PI_SWARM_AGENT"), first);
      assert.equal(environ.get("PI_SWARM_ID"), String(swarmId));
      assert.equal(environ.get("PI_SWARM_DB"), db.path);
      assert.equal(environ.get(RUNNER_PID_ENV), String(process.pid));
      assert.equal(environ.get("PROJECT_TOKEN"), "s3cret");
    }

    await waitFor(() => recipientStatus(db, early, second) === "read", "kickoff message read", 10_000);
    const kickoff = promptTexts(run.fake).find((text) => text.includes(`[swarm message #${early}]`));
    assert.ok(kickoff?.startsWith("Task for the swarm:\nBuild it."), "the message rode in the kickoff prompt");

    // Idle → wake: a message from one agent to the other starts a new run.
    await waitFor(() => agentStatus(db, swarmId, first) === "idle", "first agent idle again");
    const wake = sendMessage(db, swarmId, second, [first], "wake up", Date.now()).id;
    await waitFor(() => recipientStatus(db, wake, first) === "read", "wake message read");
    const wakePrompt = promptTexts(run.fake).find((text) => text.includes(`[swarm message #${wake}]`));
    assert.match(wakePrompt ?? "", new RegExp(`^\\[swarm message #${wake}\\] thread #\\d+ · from ${second} · to: You`));

    const result = await outcome;
    assert.equal(result.end, "finished");
    assert.equal(result.swarm.status, "finished");
    assert.deepEqual([agentStatus(db, swarmId, first), agentStatus(db, swarmId, second)], ["idle", "idle"]);
    const outbox = String(db.sql.prepare("SELECT group_concat(payload) AS p FROM events").get()?.p ?? "");
    assert.ok(!outbox.includes("s3cret"), "settings env values never reach the DB");

    // After the finish the broker still stores messages, as undeliverable with a System reply.
    const fromUser = sendMessage(db, swarmId, "User", [first], "too late", Date.now());
    assert.equal(recipientStatus(db, fromUser.id, first), "undeliverable");
    assert.deepEqual(systemReplies(db, fromUser.threadId), [UNDELIVERABLE_REPLY_TEXT]);
    const fromAgent = sendMessage(db, swarmId, first, [second], "also late", Date.now());
    assert.equal(recipientStatus(db, fromAgent.id, second), "undeliverable");
    assert.deepEqual(systemReplies(db, fromAgent.threadId), [UNDELIVERABLE_REPLY_TEXT]);
  });

  it("steers a message into a working agent and it is read at the next turn", { timeout: 20_000 }, async () => {
    const run = createRunFixture(SCENARIOS.steer);
    fixture = run;
    const { db } = run;
    const outcome = startSwarm(run.env, { name: "steer", taskPrompt: "Work.", agentAmount: 1 }, {});
    const swarmId = newestSwarmId(db);
    const [name] = agentNames(db, swarmId);
    await waitFor(() => agentStatus(db, swarmId, name) === "working", "agent working");
    const id = sendMessage(db, swarmId, "User", [name], "while you work", Date.now()).id;
    await waitFor(() => recipientStatus(db, id, name) === "delivered", "steer delivered");
    assert.equal(agentStatus(db, swarmId, name), "working", "delivered as steering, the run goes on");
    await waitFor(() => recipientStatus(db, id, name) === "read", "steer read");
    assert.equal((await outcome).end, "finished");
    assert.equal(spawnsOf(run.fake).length, 1);
    const statuses = db.sql
      .prepare("SELECT payload FROM events WHERE type = 'message.status' ORDER BY id")
      .all()
      .map((row) => JSON.parse(String(row.payload)))
      .filter((payload) => payload.messageId === id && payload.recipient.name === name)
      .map((payload) => payload.recipient.status);
    assert.deepEqual(statuses, ["delivered", "read"]);
  });
});
