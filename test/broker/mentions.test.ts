import assert from "node:assert/strict";
import { after, it } from "node:test";
import { setPostSubscription } from "../../src/broker/subscriptions.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

function recipients(swarmId: number) {
  return db.sql
    .prepare(
      `SELECT r.name, r.status, m.body FROM messages m JOIN message_recipients r ON r.message_id = m.id
     WHERE m.swarm_id = ? ORDER BY m.id, r.name`,
    )
    .all(swarmId);
}

function subscription(postId: number, name: string) {
  return db.sql.prepare("SELECT subscribed FROM post_subscriptions WHERE post_id = ? AND name = ?").get(postId, name);
}

it("notifies agents mentioned in a post without subscribing them", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "Maria", { title: "Review", text: "Please check @John and @John." }, T0);
  const rows = recipients(swarm.id);
  assert.deepEqual(
    rows.map((row) => row.name),
    ["John"],
  );
  assert.match(String(rows[0].body), /Please check @John/);
  assert.equal(subscription(post.id, "John"), undefined);
  addComment(db, swarm.id, "Liam", post.id, "No mention in this follow-up", T0 + 1);
  assert.equal(recipients(swarm.id).filter((row) => row.name === "John").length, 1);
});

it("mentions notify opted-out agents once without changing opt-out or enabling later notifications", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "Maria", { title: "Review", text: "body" }, T0);
  setPostSubscription(db, swarm.id, "Liam", post.id, false, T0);
  addComment(db, swarm.id, "John", post.id, "Please review @Liam, @Liam", T0 + 1);
  assert.equal(recipients(swarm.id).filter((row) => row.name === "Liam").length, 1);
  assert.equal(subscription(post.id, "Liam")?.subscribed, 0);
  setPostSubscription(db, swarm.id, "Liam", post.id, false, T0 + 2);
  const mention = recipients(swarm.id).find((row) => row.name === "Liam");
  assert.equal(mention?.status, "pending", "subscription cancellation must not discard a one-off mention");
  addComment(db, swarm.id, "John", post.id, "ordinary follow-up", T0 + 3);
  assert.equal(recipients(swarm.id).filter((row) => row.name === "Liam").length, 1);
  assert.equal(subscription(post.id, "Liam")?.subscribed, 0);
});

it("deduplicates a subscribed recipient mentioned repeatedly in the same comment", () => {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "Maria", { title: "Review", text: "body" }, T0);
  addComment(db, swarm.id, "John", post.id, "@Maria please check with @Maria", T0 + 1);
  assert.deepEqual(
    recipients(swarm.id).map((row) => row.name),
    ["Maria"],
  );
  assert.equal(subscription(post.id, "Maria")?.subscribed, 1);
  setPostSubscription(db, swarm.id, "Maria", post.id, false, T0 + 2);
  assert.equal(recipients(swarm.id)[0].status, "pending", "mute must not cancel the explicit mention");
});

it("ignores self mentions, unknown names, email fragments and longer name prefixes", () => {
  const swarm = seedSwarm(db);
  createPost(
    db,
    swarm.id,
    "Maria",
    {
      title: "Boundaries",
      text: "@Maria @Nobody foo@John.example @JohnExtra",
    },
    T0,
  );
  assert.deepEqual(recipients(swarm.id), []);
});

it("matches participant mentions case-insensitively, including historical participants", () => {
  const swarm = seedSwarm(db);
  db.sql.prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = ?").run(T0, swarm.id, "Liam");
  const post = createPost(
    db,
    swarm.id,
    "Maria",
    {
      title: "Review @john and @Liam",
      text: "@John is also in the body",
    },
    T0,
  );
  assert.deepEqual(
    recipients(swarm.id).map((row) => row.name),
    ["John", "Liam"],
  );
  assert.equal(subscription(post.id, "John"), undefined);
  assert.equal(subscription(post.id, "Liam"), undefined);
});

it("normal User posts notify only mentions, including beyond long body previews", () => {
  const swarm = seedSwarm(db);
  const post = createPost(
    db,
    swarm.id,
    "User",
    {
      title: "Long source",
      text: `${"source evidence ".repeat(500)} @John`,
    },
    T0,
  );
  assert.deepEqual(
    recipients(swarm.id).map((row) => row.name),
    ["John"],
  );
  assert.ok(recipients(swarm.id).every((row) => String(row.body).startsWith("User mentioned")));
  addComment(db, swarm.id, "User", post.id, `${"comment evidence ".repeat(500)} @Liam`, T0 + 1);
  assert.deepEqual(
    recipients(swarm.id).map((row) => row.name),
    ["John", "Liam"],
  );
  assert.equal(subscription(post.id, "John"), undefined);
  assert.equal(subscription(post.id, "Liam"), undefined);
});

it("rolls back mention notifications together with their wall write", () => {
  const swarm = seedSwarm(db);
  assert.throws(
    () =>
      db.write(() => {
        createPost(db, swarm.id, "Maria", { title: "Atomic", text: "@John please review" }, T0);
        throw new Error("rollback");
      }),
    /rollback/,
  );
  assert.deepEqual(recipients(swarm.id), []);
});
