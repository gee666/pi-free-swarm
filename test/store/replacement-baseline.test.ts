import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createPost } from "../../src/broker/wall.js";
import { openSwarmDb } from "../../src/store/db.js";
import {
  hasReplacementPostBaseline,
  replacementPostBaseline,
  seedReplacementPostBaseline,
} from "../../src/store/replacement-baseline.js";
import { listFreshPosts, markPostsCovered } from "../../src/store/wall-coverage.js";
import { getPostDetail } from "../../src/store/wall-queries.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
function fixture(count: number) {
  const swarm = seedSwarm(db);
  const posts = Array.from({ length: count }, (_, index) =>
    createPost(
      db,
      swarm.id,
      "Maria",
      {
        title: `History ${String(index).padStart(2, "0")}`,
        text: `body ${index}`,
      },
      T0 + index,
    ),
  );
  return { swarm, posts };
}

test("replacement last-ten baseline selects history without fabricating any delivery coverage", () => {
  const { swarm, posts } = fixture(25);
  const boundary = seedReplacementPostBaseline(db, swarm.id, "John");
  assert.equal(boundary, posts[15].id);
  assert.equal(
    db.sql.prepare("SELECT COUNT(*) AS n FROM post_coverage WHERE swarm_id = ? AND name = 'John'").get(swarm.id)?.n,
    0,
  );
  assert.deepEqual(
    listFreshPosts(db, swarm.id, "John", 100).posts.map((post) => post.id),
    posts.slice(15).map((post) => post.id),
  );
  assert.equal(listFreshPosts(db, swarm.id, "Maria", 100).total, 25);
  assert.equal(getPostDetail(db, swarm.id, posts[0].id)?.post.text, "body 0");
  const other = fixture(2);
  assert.equal(hasReplacementPostBaseline(db, other.swarm.id, "John"), false);
  assert.equal(listFreshPosts(db, other.swarm.id, "John", 100).total, 2);
});

test("replacement default wall read catches last ten then future writes, while explicit history remains available", () => {
  const { swarm, posts } = fixture(25);
  seedReplacementPostBaseline(db, swarm.id, "John");
  const tools = createAgentToolHandlers({ getDb: () => db, swarmId: swarm.id, run: 1, agentName: "John" });
  const first = tools.readPosts({});
  assert.match(first, /History 15/);
  assert.match(first, /History 24/);
  assert.doesNotMatch(first, /History 14/);
  assert.equal(listFreshPosts(db, swarm.id, "John", 100).total, 0);
  const later = createPost(db, swarm.id, "Maria", { title: "Future", text: "new work" }, T0 + 30);
  assert.match(tools.readPosts({}), new RegExp(`Post #${later.id}: Future`));
  assert.doesNotMatch(tools.readPosts({}), /History|Future/);
  assert.match(tools.readPosts({ only_new: false }), /History 14/);
  assert.match(tools.readPost({ post_id: posts[0].id }), /body 0/);
});

test("baseline persists unchanged through another connection and repeated initialization", () => {
  const { swarm, posts } = fixture(12);
  seedReplacementPostBaseline(db, swarm.id, "john");
  const other = openSwarmDb(db.path, { create: false });
  try {
    for (let index = 0; index < 5; index++)
      createPost(other, swarm.id, "Maria", { title: "After capture", text: "forward" }, T0 + 20 + index);
    assert.equal(replacementPostBaseline(other, swarm.id, "JOHN"), posts[2].id);
    assert.equal(seedReplacementPostBaseline(other, swarm.id, "John"), posts[2].id);
    const page = listFreshPosts(other, swarm.id, "John", 3);
    assert.equal(page.total, 15);
    markPostsCovered(
      db,
      swarm.id,
      "John",
      page.posts.map((post) => post.id),
    );
    assert.equal(listFreshPosts(other, swarm.id, "John", 100).total, 12);
  } finally {
    other.close();
  }
});

test("short and empty histories retain all later posts and baseline writes join rollback", () => {
  const short = fixture(3);
  assert.equal(seedReplacementPostBaseline(db, short.swarm.id, "John"), 0);
  assert.equal(hasReplacementPostBaseline(db, short.swarm.id, "John"), true);
  assert.equal(listFreshPosts(db, short.swarm.id, "John", 100).total, 3);
  const empty = fixture(0);
  assert.equal(seedReplacementPostBaseline(db, empty.swarm.id, "John"), 0);
  createPost(db, empty.swarm.id, "Maria", { title: "Later", text: "first post" }, T0);
  assert.equal(listFreshPosts(db, empty.swarm.id, "John", 100).total, 1);
  const rollback = fixture(15);
  assert.throws(
    () =>
      db.write(() => {
        seedReplacementPostBaseline(db, rollback.swarm.id, "John");
        throw new Error("rollback");
      }),
    /rollback/,
  );
  assert.equal(hasReplacementPostBaseline(db, rollback.swarm.id, "John"), false);
  assert.equal(listFreshPosts(db, rollback.swarm.id, "John", 100).total, 15);
});
