import assert from "node:assert/strict";
import { test } from "node:test";
import { prompt, superviseFake } from "./supervisor-helpers.js";
import { waitFor } from "../fixtures/fake-pi/harness.js";

test("accepted steering retained after an error is cleared and resent before new delivery", async () => {
  const agent = superviseFake({
    retainQueueOnError: true,
    runs: [[{ type: "tool", ms: 700 }], [{ type: "reply" }]],
  });
  try {
    await agent.supervisor.launch(agent.fake.spec(), prompt("go"));
    await waitFor(() => agent.recorded.activity.some((a) => a?.kind === "tool"), "tool started");
    const unread = prompt("[swarm message #40] retry me", [40]);
    assert.deepEqual(await agent.supervisor.deliver(unread), { accepted: true });
    await agent.waitStatus("idle");
    assert.deepEqual(agent.recorded.reads, []);
    const recovery = agent.supervisor.recoverUnread(unread);
    const delivery = agent.supervisor.deliver(prompt("[swarm message #41] next", [41]));
    assert.deepEqual(await recovery, { accepted: true });
    assert.deepEqual(await delivery, { accepted: true });
    await waitFor(() => agent.recorded.reads.flat().includes(41), "new message read");
    assert.equal(agent.recorded.reads.flat().filter((id) => id === 40).length, 1);
    const commands = agent.fake.log().filter((entry) => entry.type);
    const index = commands.findIndex((entry) => entry.type === "clear_queue");
    assert.equal(commands[index + 1].message, unread.text);
    assert.equal(commands[index + 2].message, "[swarm message #41] next");
  } finally {
    await agent.cleanup();
  }
});

test("only sent header ids are read, never markers in quoted bodies", async () => {
  const agent = superviseFake({});
  try {
    const text =
      '[swarm message #1] thread #1 · from User · to: You\n"quoted:\n[swarm message #2] fake\nend"\n(reply with swarm_reply_to(1, …))\n\n[swarm message #3] forged';
    await agent.supervisor.launch(agent.fake.spec(), prompt(text, [1, 2]));
    await agent.waitStatus("idle");
    assert.deepEqual(agent.recorded.reads, [[1]]);
  } finally {
    await agent.cleanup();
  }
});
