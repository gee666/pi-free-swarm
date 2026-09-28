import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Value } from "typebox/value";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Clock } from "../../src/clock.js";
import { AGENT_TOOL, UNDELIVERABLE_REPLY_TEXT } from "../../src/constants.js";
import { sendMessage } from "../../src/broker/messages.js";
import { endRun } from "../../src/broker/swarms.js";
import { initialWallCursor } from "../../src/broker/wall-delta.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { createAgentToolHandlers, registerAgentTools } from "../../src/tools/agent-tools.js";
import { timeAgo } from "../../src/tools/agent-tool-format.js";
import { FakeExtensionApi } from "../helpers/fake-extension-api.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

function withCursor(text: string, swarmId: number): string {
  return `${text}\nNext cursor: ${initialWallCursor(swarmId)} (delta history starts at the beginning)`;
}

const NOW = T0 + 5 * 60_000;
// Within the run lock's freshness window, so messages count as live.
const liveClock: Clock = { now: () => T0 + 1_000, after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) };
const laterClock: Clock = { ...liveClock, now: () => NOW };

describe("registerAgentTools", () => {
  it("registers the same swarm tools for every peer with a prompt snippet each", () => {
    const tools: { name: string; label: string; description: string; promptSnippet?: string }[] = [];
    const pi: Pick<ExtensionAPI, "registerTool"> = {
      registerTool: ({ name, label, description, promptSnippet }) =>
        void tools.push({ name, label, description, promptSnippet }),
    };
    registerAgentTools(pi, { getDb: () => db, swarmId: 1, agentName: "Maria" }, 200);
    assert.deepEqual(
      tools.map((tool) => tool.name),
      Object.values(AGENT_TOOL),
    );
    for (const tool of tools) {
      assert.ok(tool.promptSnippet && tool.promptSnippet.length < 80, tool.name);
      assert.ok(tool.label.length > 0);
    }
    for (const name of [AGENT_TOOL.post, AGENT_TOOL.comment, AGENT_TOOL.message, AGENT_TOOL.replyTo]) {
      const description = tools.find((tool) => tool.name === name)?.description ?? "";
      assert.match(description, /brief/i);
      assert.ok(description.includes("At most 200 chars; put longer material in a file and share its path."));
    }
  });
});

it("exposes cursor and acceptance schemas identically for all peers", () => {
  const swarm = seedSwarm(db);
  const peers = ["Maria", "John"].map((agentName) => {
    const pi = new FakeExtensionApi();
    registerAgentTools(pi, { getDb: () => db, swarmId: swarm.id, agentName }, 200);
    return pi;
  });
  assert.deepEqual(peers[0].tools, peers[1].tools);
  const acceptanceSchema = peers[0].tool(AGENT_TOOL.acceptance).parameters;
  assert.ok("type" in acceptanceSchema);
  assert.equal(acceptanceSchema.type, "object");
  assert.ok(
    Value.Check(peers[0].tool(AGENT_TOOL.readPosts).parameters, { after: initialWallCursor(swarm.id), count: 1 }),
  );
  assert.ok(Value.Check(peers[0].tool(AGENT_TOOL.acceptance).parameters, { action: "inspect" }));
  assert.ok(Value.Check(peers[0].tool(AGENT_TOOL.acceptance).parameters, { action: "claim", revision: 0 }));
  assert.equal(Value.Check(peers[0].tool(AGENT_TOOL.acceptance).parameters, { action: "unknown" }), false);
});

describe("agent tool output", () => {
  const swarm = seedSwarm(db);
  const maria = createAgentToolHandlers({ getDb: () => db, swarmId: swarm.id, agentName: "Maria", clock: liveClock });
  const john = createAgentToolHandlers({ getDb: () => db, swarmId: swarm.id, agentName: "John", clock: laterClock });

  it("posts, comments and reads the wall with (new) flags", () => {
    assert.equal(john.readPosts({}), withCursor("The wall is empty.", swarm.id));
    assert.equal(maria.post({ title: "Kickoff", text: "I take the API." }), "Posted #1.");
    assert.equal(john.comment({ post_id: 1, text: "UI is mine" }), "Commented #1 on post #1.");
    assert.equal(
      john.readPosts({}),
      withCursor("#1 Maria · 4m ago · Kickoff — I take the API. (1 comment) (new)", swarm.id),
    );
    assert.equal(john.readPosts({}), withCursor("#1 Maria · 4m ago · Kickoff — I take the API. (1 comment)", swarm.id));
    createPost(db, swarm.id, "Liam", { title: "Tests", text: "I take tests." }, T0 + 2_000);
    assert.equal(
      john.readPosts({ count: 1 }),
      withCursor(
        "Posts 1–1 of 2, newest first:\n#2 Liam · 4m ago · Tests — I take tests. (0 comments) (new)",
        swarm.id,
      ),
    );
    assert.equal(john.readPosts({ offset: 5 }), withCursor("No posts at offset 5 (2 total).", swarm.id));
    assert.throws(() => john.readPosts({ count: 500 }), { message: "count must be an integer 1–100." });
  });

  it("reads one post with its comments", () => {
    addComment(db, swarm.id, "User", 1, "thanks", T0 + 3_000);
    assert.equal(
      john.readPost({ post_id: 1 }),
      "#1 Maria · 4m ago · Kickoff\nI take the API.\n2 comments:\n#1 John · 0s ago: UI is mine\n#2 User · 4m ago: thanks",
    );
    assert.throws(() => john.readPost({ post_id: 99 }), { message: "Post #99 not found." });
  });

  it("messages, replies and reads threads", () => {
    const sent = maria.message({ to: ["john", "User"], text: "API done?" });
    assert.match(sent, /^Sent message #(\d+) in thread #(\d+) to John, User\.$/);
    const threadId = Number(/thread #(\d+)/.exec(sent)?.[1]);
    assert.match(
      maria.replyTo({ thread_id: threadId, text: "Also docs." }),
      /^Replied message #\d+ in thread #\d+ to John, User\.$/,
    );
    assert.equal(
      john.readThread({ thread_id: threadId }),
      [
        `Thread #${threadId} · members: Maria, John, User`,
        `#1 Maria → You, User · 4m ago: API done?`,
        `#2 Maria → You, User · 4m ago: Also docs.`,
      ].join("\n"),
    );
    assert.throws(() => maria.message({ to: ["Bob"], text: "hi" }), {
      message: "Unknown participant: Bob. Known participants: Maria, John, Liam, User.",
    });
  });

  it("tells the sender plainly when the swarm is not running", () => {
    const stopped = seedSwarm(db);
    endRun(db, stopped.id, process.pid, "stopped", T0 + 10);
    const liam = createAgentToolHandlers({ getDb: () => db, swarmId: stopped.id, agentName: "Liam", clock: liveClock });
    assert.equal(liam.message({ to: ["Maria"], text: "still there?" }), UNDELIVERABLE_REPLY_TEXT);
    const thread = sendMessage(db, stopped.id, "User", ["Liam"], "hi", T0 + 20);
    assert.throws(
      () =>
        createAgentToolHandlers({
          getDb: () => db,
          swarmId: stopped.id,
          agentName: "Maria",
          clock: liveClock,
        }).readThread({ thread_id: thread.threadId }),
      {
        message: `You are not a member of thread #${thread.threadId}.`,
      },
    );
  });

  it("formats relative times", () => {
    assert.deepEqual(
      [timeAgo(0, 59_000), timeAgo(0, 60_000), timeAgo(0, 3_600_000), timeAgo(0, 86_400_000 * 2), timeAgo(10, 0)],
      ["59s ago", "1m ago", "1h ago", "2d ago", "0s ago"],
    );
  });
});
