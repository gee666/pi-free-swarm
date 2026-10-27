import assert from "node:assert/strict";
import { test } from "node:test";
import { createPost, addComment } from "../../src/broker/wall.js";
import { sendMessage } from "../../src/broker/messages.js";
import { workFixture } from "../helpers/work-graph.js";
import { T0 } from "../helpers/temp-db.js";

test("communication accepts 100-point titles and 300-point bodies; agents must move longer text to files", (t) => {
  const f = workFixture(t);
  const post = createPost(f.db, f.swarmId, "Ann", { title: "😀".repeat(100), text: "😀".repeat(300) }, T0);
  assert.equal(Array.from(post.text).length, 300);
  for (const write of [
    () => createPost(f.db, f.swarmId, "Ann", { title: "x".repeat(101), text: "ok" }, T0),
    () => addComment(f.db, f.swarmId, "Ann", post.id, "x".repeat(301), T0),
    () => sendMessage(f.db, { swarmId: f.swarmId, from: "Ann", to: "Ben", text: "x".repeat(301), now: T0 }),
  ])
    assert.throws(write, /too long.*file/i);
  assert.match(
    createPost(f.db, f.swarmId, "User", { title: "Human input", text: "Long ".repeat(1000) }, T0).text,
    /full text:/,
  );
});
