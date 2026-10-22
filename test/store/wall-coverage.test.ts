import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { addComment, createPost } from "../../src/broker/wall.js";
import { openSwarmDb } from "../../src/store/db.js";
import {
  listFreshComments,
  listFreshPosts,
  markCommentsCovered,
  markPostsCovered,
  resetCommentCoverage,
  resetPostCoverage,
} from "../../src/store/wall-coverage.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

function fixture() {
  const swarm = seedSwarm(db);
  const posts = Array.from({ length: 4 }, (_, n) =>
    createPost(db, swarm.id, "Maria", { title: `p${n}`, text: `body${n}` }, T0),
  );
  return { swarm, posts };
}

test("v1 upgrade preserves first-use history despite legacy high-water marks", () => {
  const file = path.join(temp.cwd, "legacy-coverage.db");
  const legacy = new DatabaseSync(file);
  legacy.exec(readFileSync(new URL("../../src/store/schema.sql", import.meta.url), "utf8"));
  legacy.exec(`
    INSERT INTO swarms (id,name,task_prompt,agent_amount,status,created_at) VALUES (1,'old','task',1,'running',1);
    INSERT INTO participants (swarm_id,name,kind,status) VALUES (1,'Maria','agent','working');
    INSERT INTO posts VALUES (8,1,'Maria','old post','historical body',1);
    INSERT INTO comments VALUES (4,8,1,'Maria','historical comment',2);
    INSERT INTO read_marks VALUES (1,'Maria',999);
    PRAGMA user_version = 1;
  `);
  legacy.close();
  const upgraded = openSwarmDb(file, { create: false });
  try {
    assert.deepEqual(
      listFreshPosts(upgraded, 1, "Maria", 1).posts.map((p) => p.id),
      [8],
    );
    assert.deepEqual(
      listFreshComments(upgraded, 1, "Maria", 8, 1).comments.map((c) => c.id),
      [4],
    );
    markPostsCovered(upgraded, 1, "Maria", [8]);
    assert.equal(listFreshPosts(upgraded, 1, "Maria", 1).total, 0);
    assert.deepEqual(upgraded.sql.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    upgraded.close();
  }
});

test("first-use reads oldest history and repeated reads alone do not cover it", () => {
  const { swarm, posts } = fixture();
  for (let n = 0; n < 2; n++) {
    const page = listFreshPosts(db, swarm.id, "John", 2);
    assert.deepEqual(
      page.posts.map((p) => p.id),
      posts.slice(0, 2).map((p) => p.id),
    );
    assert.equal(page.total, 4);
  }
  markPostsCovered(db, swarm.id, "John", [posts[0].id]);
  assert.deepEqual(
    listFreshPosts(db, swarm.id, "John", 2).posts.map((p) => p.id),
    [posts[1].id, posts[2].id],
  );
});

test("sparse coverage never sweeps omitted older posts and is case-insensitive per agent", () => {
  const { swarm, posts } = fixture();
  markPostsCovered(db, swarm.id, "john", [posts[3].id]);
  assert.deepEqual(
    listFreshPosts(db, swarm.id, "JOHN", 100).posts.map((p) => p.id),
    posts.slice(0, 3).map((p) => p.id),
  );
  assert.equal(listFreshPosts(db, swarm.id, "Maria", 100).total, 4);
  resetPostCoverage(db, swarm.id, "John");
  assert.equal(listFreshPosts(db, swarm.id, "John", 100).total, 4);
});

test("comments are isolated by post, agent and swarm, with independent replay", () => {
  const { swarm, posts } = fixture();
  const first = addComment(db, swarm.id, "Maria", posts[0].id, "one", T0).comment;
  const second = addComment(db, swarm.id, "Maria", posts[1].id, "two", T0).comment;
  markCommentsCovered(db, swarm.id, "John", [second.id]);
  assert.equal(listFreshComments(db, swarm.id, "John", posts[0].id, 1).comments[0].id, first.id);
  assert.equal(listFreshComments(db, swarm.id, "John", posts[1].id, 1).total, 0);
  assert.equal(listFreshComments(db, swarm.id, "Maria", posts[1].id, 1).total, 1);
  assert.equal(listFreshComments(db, swarm.id + 999, "John", posts[0].id, 1).total, 0);
  resetCommentCoverage(db, swarm.id, "John", posts[0].id);
  assert.equal(listFreshComments(db, swarm.id, "John", posts[1].id, 1).total, 0);
  resetCommentCoverage(db, swarm.id, "John", posts[1].id);
  assert.equal(listFreshComments(db, swarm.id, "John", posts[1].id, 1).total, 1);
});

test("interleaved connections, overlapping read pages and restart preserve every unseen item", () => {
  const { swarm, posts } = fixture();
  const other = openSwarmDb(db.path, { create: false });
  try {
    const left = listFreshPosts(db, swarm.id, "John", 2);
    const right = listFreshPosts(other, swarm.id, "John", 2);
    const inserted = createPost(other, swarm.id, "Maria", { title: "later", text: "new" }, T0);
    markPostsCovered(
      db,
      swarm.id,
      "John",
      left.posts.map((p) => p.id),
    );
    markPostsCovered(
      other,
      swarm.id,
      "John",
      right.posts.map((p) => p.id),
    );
    assert.deepEqual(
      listFreshPosts(other, swarm.id, "John", 100).posts.map((p) => p.id),
      [posts[2].id, posts[3].id, inserted.id],
    );
  } finally {
    other.close();
  }
  const reopened = openSwarmDb(db.path, { create: false });
  try {
    assert.equal(listFreshPosts(reopened, swarm.id, "John", 100).total, 3);
  } finally {
    reopened.close();
  }
});

test("comments arriving between pages remain available and foreign IDs cannot be covered", () => {
  const { swarm, posts } = fixture();
  const foreign = fixture();
  const one = addComment(db, swarm.id, "Maria", posts[0].id, "one", T0).comment;
  const page = listFreshComments(db, swarm.id, "John", posts[0].id, 1);
  const two = addComment(db, swarm.id, "Maria", posts[0].id, "two", T0).comment;
  markCommentsCovered(
    db,
    swarm.id,
    "John",
    page.comments.map((c) => c.id),
  );
  markPostsCovered(
    db,
    swarm.id,
    "John",
    foreign.posts.map((p) => p.id),
  );
  assert.deepEqual(
    listFreshComments(db, swarm.id, "John", posts[0].id, 1).comments.map((c) => c.id),
    [two.id],
  );
  assert.equal(listFreshPosts(db, foreign.swarm.id, "John", 100).total, 4);
  assert.notEqual(one.id, two.id);
});

test("coverage joins caller transaction rollback and rejects unbounded page counts", () => {
  const { swarm, posts } = fixture();
  assert.throws(
    () =>
      db.write(() => {
        markPostsCovered(db, swarm.id, "John", [posts[0].id]);
        throw new Error("rollback");
      }),
    /rollback/,
  );
  assert.equal(listFreshPosts(db, swarm.id, "John", 100).total, 4);
  for (const count of [0, -1, 101, 1.5, Infinity]) {
    assert.throws(() => listFreshPosts(db, swarm.id, "John", count), /count must/);
    assert.throws(() => listFreshComments(db, swarm.id, "John", posts[0].id, count), /count must/);
  }
});
