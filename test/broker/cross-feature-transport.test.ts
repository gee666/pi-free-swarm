import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSupervisor } from "../../src/agents/supervisor.js";
import { recordUsage } from "../../src/broker/agent-state.js";
import { markDelivered, markRead } from "../../src/broker/delivery-state.js";
import { coverCommentNotifications } from "../../src/broker/subscriptions.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { formatDeliveredMessages } from "../../src/message-format.js";
import { resolveModelAssignments } from "../../src/model-allocation.js";
import { readBudget } from "../../src/store/budget.js";
import { latestEventId, scanEventsAfter } from "../../src/store/events.js";
import { getMessages, listOpenAgentRecipients } from "../../src/store/message-queries.js";
import { listFreshComments } from "../../src/store/wall-coverage.js";
import { createFakePiRun, SCENARIOS, useFakePi, waitFor } from "../fixtures/fake-pi/harness.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

test("mixed-model child queues subscribed comments, observes cursors and attributes budget usage through unknown event pages", async () => {
  useFakePi();
  const temp = createTempDb();
  const swarm = seedSwarm(temp.db);
  const fixture = createFakePiRun(SCENARIOS.steer);
  const profiles = [
    { provider: "fixture", model: "first", thinkingLevel: "low", count_proportional: 1 },
    { provider: "fixture", model: "second", thinkingLevel: "high" },
  ];
  const assignments = resolveModelAssignments(
    2,
    profiles,
    null,
    profiles.map((profile) => ({
      provider: profile.provider,
      id: profile.model,
      thinkingLevels: [profile.thinkingLevel],
    })),
  );
  assert.deepEqual(
    assignments.map((assignment) => assignment.modelId),
    ["first", "second"],
  );
  const spec = fixture.spec("Maria");
  spec.context.model = assignments[1];
  const supervisor = new AgentSupervisor({
    name: "Maria",
    watchdog: { startupTimeoutMs: 10_000, idleTimeoutMs: 10_000, startupRetries: 0 },
    hooks: {
      onStatus: () => {},
      onActivity: () => {},
      onCrash: (crash) => assert.fail(crash.message),
      onUsage: (sample) => recordUsage(temp.db, swarm.id, "Maria", sample, T0 + 10),
      onMessagesRead: (ids) => {
        markRead(temp.db, swarm.id, "Maria", ids, T0 + 10);
        coverCommentNotifications(temp.db, swarm.id, "Maria", ids);
      },
    },
  });
  try {
    await supervisor.launch(spec, { text: "Work on fixture", messageIds: [] });
    await waitFor(() => supervisor.status === "working", "busy child");
    const post = createPost(temp.db, swarm.id, "Maria", { title: "Evidence", text: "Artifacts" }, T0);
    const before = latestEventId(temp.db);
    temp.db.sql
      .prepare("INSERT INTO events (swarm_id, type, payload, created_at) VALUES (?, ?, ?, ?)")
      .run(swarm.id, "future_unknown", "{}", T0);
    const first = addComment(temp.db, swarm.id, "John", post.id, "First exact comment body", T0 + 1).comment;
    const second = addComment(temp.db, swarm.id, "John", post.id, "Second exact comment body", T0 + 2).comment;
    const pending = listOpenAgentRecipients(temp.db, swarm.id).filter((recipient) => recipient.name === "Maria");
    assert.equal(pending.length, 2);
    for (const recipient of pending) {
      const messages = getMessages(temp.db, [recipient.messageId]);
      assert.deepEqual(
        await supervisor.deliver({
          text: formatDeliveredMessages(messages, "Maria"),
          messageIds: [recipient.messageId],
        }),
        { accepted: true },
      );
      markDelivered(temp.db, swarm.id, "Maria", [recipient.messageId], T0 + 3);
    }
    assert.equal(listFreshComments(temp.db, swarm.id, "Maria", post.id, 10).total, 2);
    await waitFor(() => supervisor.status === "idle", "steering observed");
    assert.equal(listFreshComments(temp.db, swarm.id, "Maria", post.id, 10).total, 0);
    assert.equal(listFreshComments(temp.db, swarm.id, "Liam", post.id, 10).total, 2);
    const commands = fixture.log();
    assert.equal(commands.find((command) => command.type === "set_steering_mode")?.mode, "all");
    for (const comment of [first, second]) {
      assert.ok(
        commands.some((command) => typeof command.message === "string" && command.message.includes(comment.text)),
      );
    }
    const spawn = commands.find((command) => command.fake === "spawn");
    assert.ok(Array.isArray(spawn?.argv) && spawn.argv.includes("fixture/second") && spawn.argv.includes("high"));
    const budget = readBudget(temp.db, swarm.id, { budgetMoneyUsd: 1, gracefulShutdownOnBudget: false }, T0 + 10);
    assert.ok(budget.costUsd > 0);
    assert.equal(budget.exhausted, null);
    const unknown = scanEventsAfter(temp.db, before, 1);
    assert.equal(unknown.events.length, 0);
    assert.ok(unknown.scannedThrough > before && unknown.hasMore);
    const subsequent = scanEventsAfter(temp.db, unknown.scannedThrough, 100);
    assert.ok(subsequent.events.length > 0);
  } finally {
    await supervisor.stop();
    fixture.cleanup();
    temp.cleanup();
  }
});
