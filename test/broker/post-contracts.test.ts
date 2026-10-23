import assert from "node:assert/strict";
import { after, it } from "node:test";
import { BODY_SAFETY_MAX } from "../../src/limits.js";
import { readPostContract, writePostContract } from "../../src/broker/post-contracts.js";
import { claimPostRole } from "../../src/broker/post-claims.js";
import { createPost } from "../../src/broker/wall.js";
import { openSwarmDb } from "../../src/store/db.js";
import { getPostContract } from "../../src/store/post-contracts.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

function fixture() {
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "User", { title: "Contract", text: "Original post" }, T0);
  return { swarm, post };
}

function contractEvents(swarmId: number) {
  return db.sql.prepare("SELECT * FROM events WHERE swarm_id = ? AND type = 'post.contract.updated'").all(swarmId);
}

it("creates from revision zero and preserves the exact document through successive edits", () => {
  const { swarm, post } = fixture();
  assert.equal(readPostContract(db, swarm.id, "Maria", post.id), null);
  const text = "  Shared agreement\n\nKeep Unicode 🧪 intact.\n";
  const first = writePostContract(db, swarm.id, "Maria", post.id, text, 0, T0 + 1);
  assert.deepEqual(first, { postId: post.id, revision: 1, text, updatedBy: "Maria", updatedAt: T0 + 1 });
  const second = writePostContract(db, swarm.id, "John", post.id, "Revised agreement", 1, T0 + 2);
  assert.deepEqual(second, {
    postId: post.id,
    revision: 2,
    text: "Revised agreement",
    updatedBy: "John",
    updatedAt: T0 + 2,
  });
  assert.deepEqual(getPostContract(db, swarm.id, post.id), second);
  assert.equal(contractEvents(swarm.id).length, 2);
});

it("rejects stale create and edit attempts across database handles without changing the winner or event count", () => {
  const { swarm, post } = fixture();
  const other = openSwarmDb(db.path, { create: false });
  try {
    const first = writePostContract(db, swarm.id, "Maria", post.id, "Creation winner", 0, T0 + 1);
    assert.throws(
      () => writePostContract(other, swarm.id, "John", post.id, "Stale creation", 0, T0 + 2),
      /revision.*1/i,
    );
    assert.deepEqual(getPostContract(other, swarm.id, post.id), first);
    assert.equal(contractEvents(swarm.id).length, 1);
    const second = writePostContract(other, swarm.id, "John", post.id, "Edit winner", 1, T0 + 3);
    assert.throws(() => writePostContract(db, swarm.id, "Maria", post.id, "Stale edit", 1, T0 + 4), /revision.*2/i);
    assert.deepEqual(getPostContract(db, swarm.id, post.id), second);
    assert.equal(contractEvents(swarm.id).length, 2);
  } finally {
    other.close();
  }
});

it("rolls back a document and its event together on failed enclosing transactions", () => {
  const { swarm, post } = fixture();
  assert.throws(
    () =>
      db.write(() => {
        writePostContract(db, swarm.id, "Maria", post.id, "Rolled back creation", 0, T0 + 1);
        throw new Error("rollback creation");
      }),
    /rollback creation/,
  );
  assert.equal(getPostContract(db, swarm.id, post.id), null);
  assert.equal(contractEvents(swarm.id).length, 0);
  const winner = writePostContract(db, swarm.id, "Maria", post.id, "Saved", 0, T0 + 2);
  assert.throws(
    () =>
      db.write(() => {
        writePostContract(db, swarm.id, "John", post.id, "Rolled back edit", 1, T0 + 3);
        throw new Error("rollback edit");
      }),
    /rollback edit/,
  );
  assert.deepEqual(getPostContract(db, swarm.id, post.id), winner);
  assert.equal(contractEvents(swarm.id).length, 1);
});

it("does not change post text, comments, subscriptions or messages", () => {
  const { swarm, post } = fixture();
  const subscriptions = db.sql.prepare("SELECT * FROM post_subscriptions WHERE post_id = ?").all(post.id);
  writePostContract(db, swarm.id, "Maria", post.id, "Independent agreement", 0, T0 + 1);
  readPostContract(db, swarm.id, "John", post.id);
  assert.deepEqual(db.sql.prepare("SELECT * FROM post_subscriptions WHERE post_id = ?").all(post.id), subscriptions);
  assert.equal(db.sql.prepare("SELECT body FROM posts WHERE id = ?").get(post.id)?.body, "Original post");
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM comments WHERE post_id = ?").get(post.id)?.n, 0);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM messages WHERE swarm_id = ?").get(swarm.id)?.n, 0);
});

it("counts document limits in Unicode code points and preserves the winner after an oversized edit", () => {
  const { swarm, post } = fixture();
  const text = "🧪".repeat(BODY_SAFETY_MAX);
  const winner = writePostContract(db, swarm.id, "Maria", post.id, text, 0, T0 + 1);
  assert.equal(winner.text, text);
  assert.throws(() => writePostContract(db, swarm.id, "John", post.id, `${text}x`, 1, T0 + 2));
  assert.deepEqual(getPostContract(db, swarm.id, post.id), winner);
  assert.equal(contractEvents(swarm.id).length, 1);
});

it("notifies each claimant once for a committed User edit without changing subscriptions", () => {
  const { swarm, post } = fixture();
  claimPostRole(db, swarm.id, "Maria", post.id, "implementation", T0);
  claimPostRole(db, swarm.id, "Maria", post.id, "review", T0);
  claimPostRole(db, swarm.id, "John", post.id, "tests", T0);
  claimPostRole(db, swarm.id, "Liam", post.id, "previous owner", T0);
  db.sql.prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = ?").run(T0, swarm.id, "Liam");
  const subscriptions = db.sql.prepare("SELECT * FROM post_subscriptions WHERE post_id = ?").all(post.id);
  const contract = writePostContract(db, swarm.id, "User", post.id, "User agreement", 0, T0 + 1);
  assert.equal(contract.updatedBy, "User");
  assert.equal(contract.revision, 1);
  const recipients = () =>
    db.sql.prepare("SELECT name FROM message_recipients WHERE swarm_id = ? ORDER BY name").all(swarm.id);
  assert.deepEqual(
    recipients().map((row) => row.name),
    ["John", "Maria"],
  );
  writePostContract(db, swarm.id, "John", post.id, "Agent agreement", 1, T0 + 2);
  assert.deepEqual(
    recipients().map((row) => row.name),
    ["John", "Maria"],
  );
  assert.throws(() => writePostContract(db, swarm.id, "User", post.id, "Stale agreement", 1, T0 + 3));
  assert.deepEqual(
    recipients().map((row) => row.name),
    ["John", "Maria"],
  );
  assert.throws(
    () =>
      db.write(() => {
        writePostContract(db, swarm.id, "User", post.id, "Rolled back", 2, T0 + 4);
        throw new Error("rollback notification");
      }),
    /rollback notification/,
  );
  assert.deepEqual(
    recipients().map((row) => row.name),
    ["John", "Maria"],
  );
  assert.equal(getPostContract(db, swarm.id, post.id)?.text, "Agent agreement");
  assert.equal(contractEvents(swarm.id).length, 2);
  assert.deepEqual(db.sql.prepare("SELECT * FROM post_subscriptions WHERE post_id = ?").all(post.id), subscriptions);
});

it("rejects invalid revisions, blank text, unauthorized writers and foreign posts without a document", () => {
  const { swarm, post } = fixture();
  const other = seedSwarm(db);
  for (const revision of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => writePostContract(db, swarm.id, "Maria", post.id, "Body", revision, T0));
  }
  assert.throws(() => writePostContract(db, swarm.id, "Maria", post.id, " \n ", 0, T0));
  assert.throws(() => writePostContract(db, swarm.id, "Unknown", post.id, "Body", 0, T0));
  assert.throws(() => writePostContract(db, other.id, "Maria", post.id, "Body", 0, T0), /not found/i);
  assert.throws(() => readPostContract(db, other.id, "Maria", post.id), /not found/i);
  db.sql.prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = ?").run(T0, swarm.id, "Maria");
  assert.throws(() => writePostContract(db, swarm.id, "Maria", post.id, "Body", 0, T0));
  assert.equal(getPostContract(db, swarm.id, post.id), null);
  assert.equal(contractEvents(swarm.id).length, 0);
});
