import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSupervisor } from "../../src/agents/supervisor.js";
import { messagePrompt } from "../../src/broker/message-prompt.js";
import { systemNotice } from "../helpers/system-notice.js";
import { setPostSubscription } from "../../src/broker/subscriptions.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { fakeTransportFactory } from "../agents/fake-transport.js";
import { RELAXED_WATCHDOG } from "../agents/supervisor-helpers.js";
import { createFakePiRun } from "../fixtures/fake-pi/harness.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";
import { openSwarmDb } from "../../src/store/db.js";

test("a database failure during before-send refresh reports the run error without sending", () => {
  const temp = createTempDb();
  const db = openSwarmDb(temp.db.path, { create: false });
  const errors: unknown[] = [];
  try {
    const swarm = seedSwarm(db);
    const message = systemNotice(db, { swarmId: swarm.id, to: "Maria", text: "saved work", now: T0 });
    const prompt = messagePrompt(db, swarm.id, "Maria", [message.id], undefined, (error) => errors.push(error));
    assert.ok(prompt?.beforeSend);
    db.close();
    assert.equal(prompt.beforeSend(), null);
    assert.equal(errors.length, 1);
    assert.ok(errors[0] instanceof Error);
  } finally {
    temp.cleanup();
  }
});

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

test("unsubscribe cancels a notification waiting behind a serialized transport send", async () => {
  const temp = createTempDb();
  const fixture = createFakePiRun({});
  const fake = fakeTransportFactory();
  const supervisor = new AgentSupervisor({
    name: "Maria",
    transportFactory: fake.factory,
    watchdog: RELAXED_WATCHDOG,
    hooks: { onStatus() {}, onUsage() {}, onActivity() {}, onCrash() {}, onMessagesRead() {} },
  });
  try {
    const swarm = seedSwarm(temp.db);
    const post = createPost(temp.db, swarm.id, "Maria", { title: "Discussion", text: "body" }, T0);
    const ordinary = systemNotice(temp.db, { swarmId: swarm.id, to: "Maria", text: "ordinary remains", now: T0 });
    const comment = addComment(temp.db, swarm.id, "User", post.id, "cancel before actual send", T0).comment;
    const row = temp.db.sql
      .prepare("SELECT message_id FROM comment_notifications WHERE comment_id = ?")
      .get(comment.id);
    assert.ok(row && typeof row.message_id === "number");
    const notificationId = row.message_id;
    const launching = supervisor.launch(fixture.spec(), null);
    const transport = fake.instances[0];
    assert.ok(transport);
    transport.respond();
    await launching;
    const firstPrompt = messagePrompt(temp.db, swarm.id, "Maria", [ordinary.id]);
    const notification = messagePrompt(temp.db, swarm.id, "Maria", [notificationId]);
    assert.ok(firstPrompt && notification);
    const first = supervisor.deliver(firstPrompt);
    const second = supervisor.deliver(notification);
    await flush();
    assert.equal(transport.commands.filter((command) => command.type === "prompt").length, 1);
    setPostSubscription(temp.db, swarm.id, "Maria", post.id, false, T0 + 1);
    transport.respond();
    assert.equal((await first).accepted, true);
    assert.equal((await second).accepted, false);
    assert.equal(transport.commands.filter((command) => command.type === "prompt").length, 1);
    const mixedLaunch = messagePrompt(
      temp.db,
      swarm.id,
      "Maria",
      [ordinary.id, notificationId],
      (messages) => `Kickoff\n${messages}`,
    );
    assert.ok(mixedLaunch);
    assert.match(mixedLaunch.text, /Kickoff[\s\S]*ordinary remains/);
    assert.doesNotMatch(mixedLaunch.text, /cancel before actual send/);
    assert.deepEqual(mixedLaunch.messageIds, [ordinary.id]);
  } finally {
    await supervisor.stop();
    fixture.cleanup();
    temp.cleanup();
  }
});
