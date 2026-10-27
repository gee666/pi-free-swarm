import assert from "node:assert/strict";
import { test } from "node:test";
import { workFixture } from "../helpers/work-graph.js";
import { createPost, addComment } from "../../src/broker/wall.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { sendMessage } from "../../src/broker/messages.js";
import { T0 } from "../helpers/temp-db.js";

test("search and paged reads do not publish write events or create read marks", async (t) => {
  const f = workFixture(t);
  const post = createPost(
    f.db,
    f.swarmId,
    "User",
    { title: "Long human input", text: "Human material ".repeat(1000) },
    T0,
  );
  for (let i = 0; i < 3; i++) addComment(f.db, f.swarmId, "User", post.id, `Comment ${i}`, T0);
  sendMessage(f.db, { swarmId: f.swarmId, from: "User", to: "Ann", text: "Please review", now: T0 });
  const tools = createAgentToolHandlers({ getDb: () => f.db, swarmId: f.swarmId, run: 1, agentName: "Ann" });
  const before = f.db.sql.prepare("SELECT count(*) AS n FROM events").get()?.n;
  assert.match(await tools.postsSearch({ author: "User" }), /Long human input/);
  const first = tools.postsGet({ id: post.id, limit: 1 });
  assert.match(first, /full text:/);
  const cursor = /Next cursor: (\S+)/.exec(first)?.[1];
  assert.match(tools.postsGet({ id: post.id, cursor, limit: 1 }), /Comment 1/);
  assert.match(tools.messagesRead({ with: "User" }), /Please review/);
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM events").get()?.n, before);
  assert.equal(f.db.sql.prepare("SELECT 1 FROM sqlite_master WHERE name = 'read_marks'").get(), undefined);
});
