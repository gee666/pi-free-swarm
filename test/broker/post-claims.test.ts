import assert from "node:assert/strict";
import { after, it } from "node:test";
import { TITLE_MAX } from "../../src/limits.js";
import { claimPostRole } from "../../src/broker/post-claims.js";
import { createPost } from "../../src/broker/wall.js";
import { listPostClaims } from "../../src/store/post-claims.js";
import { openSwarmDb } from "../../src/store/db.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

it("returns the first owner for a duplicate role across database handles", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "User", { title: "Research", text: "Compare sources" }, T0);
  const other = openSwarmDb(db.path, { create: false });
  try {
    const first = claimPostRole(db, swarm.id, "Maria", post.id, "research", T0 + 1);
    const second = claimPostRole(other, swarm.id, "John", post.id, "research", T0 + 2);
    assert.equal(first.claimed, true);
    assert.equal(second.claimed, false);
    assert.deepEqual(second.claim, first.claim);
    assert.equal(second.claim.agent, "Maria");
    assert.equal(listPostClaims(other, swarm.id, post.id).length, 1);
  } finally {
    other.close();
  }
});

it("supports free-form distinct roles, trims surrounding whitespace and makes owner retries idempotent", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "User", { title: "Research", text: "Compare sources" }, T0);
  const first = claimPostRole(db, swarm.id, "Maria", post.id, "  tests  ", T0 + 1);
  const retry = claimPostRole(db, swarm.id, "Maria", post.id, "tests", T0 + 2);
  assert.equal(first.claim.role, "tests");
  assert.equal(retry.claimed, true);
  assert.deepEqual(retry.claim, first.claim);
  assert.equal(
    db.sql.prepare("SELECT COUNT(*) AS n FROM events WHERE swarm_id = ? AND type = 'post.claimed'").get(swarm.id)?.n,
    1,
  );
  assert.equal(claimPostRole(db, swarm.id, "John", post.id, "testing", T0 + 3).claimed, true);
  assert.equal(claimPostRole(db, swarm.id, "Liam", post.id, "historical source analysis", T0 + 4).claimed, true);
  assert.deepEqual(
    listPostClaims(db, swarm.id, post.id)
      .map((claim) => claim.role)
      .sort(),
    ["historical source analysis", "testing", "tests"],
  );
});

it("isolates claims by post and swarm and rejects cross-swarm post IDs", () => {
  const swarm = seedSwarm(db);
  const other = seedSwarm(db);
  const first = createPost(db, swarm.id, "User", { title: "One", text: "body" }, T0);
  const second = createPost(db, swarm.id, "User", { title: "Two", text: "body" }, T0);
  const third = createPost(db, other.id, "User", { title: "Three", text: "body" }, T0);
  assert.equal(claimPostRole(db, swarm.id, "Maria", first.id, "research", T0).claimed, true);
  assert.equal(claimPostRole(db, swarm.id, "John", second.id, "research", T0).claimed, true);
  assert.equal(claimPostRole(db, other.id, "Liam", third.id, "research", T0).claimed, true);
  assert.throws(() => claimPostRole(db, other.id, "John", first.id, "review", T0), /not found/i);
  assert.equal(listPostClaims(db, other.id, first.id).length, 0);
});

it("does not comment, subscribe or notify when recording a claim or returning its winner", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "User", { title: "Research", text: "body" }, T0);
  const subscriptions = db.sql.prepare("SELECT * FROM post_subscriptions WHERE post_id = ?").all(post.id);
  claimPostRole(db, swarm.id, "Maria", post.id, "research", T0 + 1);
  claimPostRole(db, swarm.id, "John", post.id, "research", T0 + 2);
  assert.deepEqual(db.sql.prepare("SELECT * FROM post_subscriptions WHERE post_id = ?").all(post.id), subscriptions);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM comments WHERE post_id = ?").get(post.id)?.n, 0);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM messages WHERE swarm_id = ?").get(swarm.id)?.n, 0);
});

it("rejects nonagent and retired claimants without recording a role", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "User", { title: "Research", text: "body" }, T0);
  assert.throws(() => claimPostRole(db, swarm.id, "User", post.id, "research", T0), /Only agents/i);
  db.sql.prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = ?").run(T0, swarm.id, "Maria");
  assert.throws(() => claimPostRole(db, swarm.id, "Maria", post.id, "research", T0 + 1), /retired/i);
  assert.deepEqual(listPostClaims(db, swarm.id, post.id), []);
});

it("rejects blank roles and rolls claims back with their transaction", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "User", { title: "Research", text: "body" }, T0);
  assert.throws(() => claimPostRole(db, swarm.id, "Maria", post.id, "  ", T0), /role/i);
  assert.throws(() => claimPostRole(db, swarm.id, "Maria", post.id, "one\ntwo", T0), /role/i);
  assert.throws(() => claimPostRole(db, swarm.id, "Maria", post.id, "x".repeat(TITLE_MAX + 1), T0), /role/i);
  assert.throws(
    () =>
      db.write(() => {
        claimPostRole(db, swarm.id, "Maria", post.id, "research", T0);
        throw new Error("rollback");
      }),
    /rollback/,
  );
  assert.deepEqual(listPostClaims(db, swarm.id, post.id), []);
});
