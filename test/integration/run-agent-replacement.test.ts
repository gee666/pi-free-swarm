import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { systemNotice } from "../helpers/system-notice.js";
import { finishWork } from "../helpers/finish-work.js";
import { requestRetirement } from "../../src/broker/retirement.js";
import { snoozeReminders } from "../../src/broker/reminder-snooze.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { activeWorkerNames, getActiveAssignments } from "../../src/store/active-roster.js";
import { getMessages } from "../../src/store/message-queries.js";
import { listAgentSessions } from "../../src/store/swarm-queries.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { SCENARIOS } from "../fixtures/fake-pi/harness.js";
import { configurationOwner } from "./configuration-fixture.js";
import { agentStatus, createRunFixture, isAlive, recipientStatus, waitFor } from "./run-fixture.js";

test(
  "retirement preserves history and gives the replacement a brief path, graph discovery and handoff",
  { timeout: 45_000 },
  async () => {
    const run = createRunFixture(SCENARIOS.settle);
    const initialRelease = path.join(run.cwd, "initial-release");
    const oldBusyRelease = path.join(run.cwd, "old-busy-release");
    const replacementRelease = path.join(run.cwd, "replacement-release");
    writeFileSync(
      run.fake.env.FAKE_PI_SCENARIO,
      JSON.stringify({
        agents: { Watcher: {} },
        spawns: [
          {
            runs: [
              [{ type: "waitForFile", file: initialRelease }, { type: "reply" }],
              [{ type: "waitForFile", file: oldBusyRelease }, { type: "reply" }],
            ],
          },
          { runs: [[{ type: "waitForFile", file: replacementRelease }, { type: "reply" }]] },
        ],
      }),
    );
    const owner = await configurationOwner(run, 1);
    const { swarmId } = owner;
    try {
      const [oldName] = activeWorkerNames(run.db, swarmId);
      await waitFor(() => agentStatus(run.db, swarmId, oldName) === "working", "first worker's initial turn");
      assert.throws(() => snoozeReminders(run.db, swarmId, oldName, Date.now()), /first idle/i);
      writeFileSync(initialRelease, "ready");
      await waitFor(() => agentStatus(run.db, swarmId, oldName) === "idle", "first genuine idle");
      const originalAssignment = getActiveAssignments(run.db, swarmId)[0];
      const oldSession = listAgentSessions(run.db, swarmId).find((worker) => worker.name === oldName);
      assert.ok(oldSession);
      const oldContent = readFileSync(oldSession.sessionFile, "utf8");
      const posts = Array.from({ length: 13 }, (_, index) =>
        createPost(run.db, swarmId, "User", { title: `Earlier ${index}`, text: `WALL-BASELINE-${index}` }, Date.now()),
      );
      const discussion = createPost(
        run.db,
        swarmId,
        oldName,
        { title: "Old discussion", text: "OLD-NOTIFICATION-POST" },
        Date.now(),
      );
      systemNotice(run.db, { swarmId: swarmId, to: oldName, text: "OLD-SECOND-TURN-TRIGGER", now: Date.now() });
      await owner.advance(50);
      await waitFor(() => agentStatus(run.db, swarmId, oldName) === "working", "old worker's later active turn");
      const unread = systemNotice(run.db, {
        swarmId: swarmId,
        to: oldName,
        text: "OLD-PRIVATE-UNREAD",
        now: Date.now(),
      });
      const comment = addComment(
        run.db,
        swarmId,
        "User",
        discussion.id,
        "OLD-COMMENT-NOTIFICATION",
        Date.now(),
      ).comment;
      await owner.advance(50);
      await waitFor(() => recipientStatus(run.db, unread.id, oldName) === "delivered", "old unread message accepted");
      const oldSpawn = run.fake.log().find((entry) => entry.fake === "spawn" && entry.agent === oldName);
      assert.ok(oldSpawn && typeof oldSpawn.pid === "number");
      const handoff =
        "Replacement handoff overview. Verified the fixture. Remaining work: inspect current artifacts before acting.";
      const retirement = requestRetirement(run.db, swarmId, oldName, 1, handoff, Date.now());
      assert.equal(readFileSync(path.join(run.db.dataDir, retirement.handoffFile), "utf8"), handoff);
      await owner.waitApplied(retirement.requestId);
      const [newName] = activeWorkerNames(run.db, swarmId);
      assert.notEqual(newName, oldName);
      assert.equal(isAlive(oldSpawn.pid), false);
      await waitFor(() => agentStatus(run.db, swarmId, newName) === "working", "fresh replacement starts its own turn");
      const next = getActiveAssignments(run.db, swarmId)[0];
      assert.deepEqual({ ...next, name: oldName }, originalAssignment);

      assert.throws(() => snoozeReminders(run.db, swarmId, newName, Date.now()), /first idle/i);
      const prompt = run.fake.log().find((entry) => entry.type === "prompt" && entry.agent === newName);
      assert.ok(prompt && typeof prompt.message === "string");
      assert.ok(prompt.message.includes(handoff));
      for (const oldText of [
        "OLD-PRIVATE-UNREAD",
        "OLD-SECOND-TURN-TRIGGER",
        "OLD-COMMENT-NOTIFICATION",
        "OLD-NOTIFICATION-POST",
      ])
        assert.ok(!prompt.message.includes(oldText));
      const replacementSpawn = run.fake.log().find((entry) => entry.fake === "spawn" && entry.agent === newName);
      assert.ok(replacementSpawn && Array.isArray(replacementSpawn.argv));
      const argv = replacementSpawn.argv.map(String);
      assert.equal(argv[argv.indexOf("--model") + 1], `${originalAssignment.provider}/${originalAssignment.modelId}`);
      assert.equal(argv[argv.indexOf("--thinking") + 1], originalAssignment.thinkingLevel);
      const system = readFileSync(argv[argv.indexOf("--append-system-prompt") + 1], "utf8");
      assert.match(system, /\.pi\/swarm\/work\/\d+\/brief\.md/);
      assert.doesNotMatch(system, /<swarm-task>/);
      const newSession = listAgentSessions(run.db, swarmId).find((worker) => worker.name === newName);
      assert.ok(newSession && newSession.sessionFile !== oldSession.sessionFile);
      assert.ok(readFileSync(oldSession.sessionFile, "utf8").startsWith(oldContent));
      assert.equal(
        getMessages(run.db, [unread.id])[0].recipients.some((recipient) => recipient.name === newName),
        false,
      );
      assert.notEqual(recipientStatus(run.db, unread.id, oldName), "read");
      assert.ok(run.db.sql.prepare("SELECT id FROM comments WHERE id = ?").get(comment.id));
      const tools = createAgentToolHandlers({ getDb: () => run.db, swarmId, run: 1, agentName: newName });
      const results = await tools.postsSearch({ limit: 50 });
      for (const post of posts) assert.ok(results.includes(post.title));
      assert.ok(tools.postsGet({ id: posts[0].id }).includes(posts[0].text));
      writeFileSync(replacementRelease, "ready");
      await waitFor(() => agentStatus(run.db, swarmId, newName) === "idle", "replacement's first genuine idle");
      assert.ok(snoozeReminders(run.db, swarmId, newName, Date.now()) > Date.now());
      finishWork(run.db, swarmId);
      await owner.finished();
    } finally {
      await owner.close();
      run.cleanup();
    }
  },
);
