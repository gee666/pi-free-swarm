import assert from "node:assert/strict";
import { it } from "node:test";
import type { PostContract, PostDetailResponse } from "../../src/api-types.js";
import { claimPostRole } from "../../src/broker/post-claims.js";
import { writePostContract } from "../../src/broker/post-contracts.js";
import { createPost } from "../../src/broker/wall.js";
import { getPostContract } from "../../src/store/post-contracts.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { getJson, postJson, startTestBoard } from "./helpers.js";

it("saves User contract edits and notifies each claimant once without subscribing anyone", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { db } = board.temp;
  const now = Date.now();
  const swarm = seedSwarm(db, { now });
  const post = createPost(db, swarm.id, "Liam", { title: "Editable agreement", text: "Original post body." }, now);
  claimPostRole(db, swarm.id, "Maria", post.id, "research", now);
  claimPostRole(db, swarm.id, "Maria", post.id, "sources", now);
  claimPostRole(db, swarm.id, "John", post.id, "tests", now);
  writePostContract(db, swarm.id, "Maria", post.id, "Agent draft", 0, now);
  const endpoint = `${board.base}/api/swarms/${swarm.id}/posts/${post.id}/contract`;
  const text = `  # User agreement\n\n${"Preserved details 😀\n".repeat(30)}Final clause.  `;
  const saved = await postJson<{ contract: PostContract }>(endpoint, { text, expectedRevision: 1 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.contract.updatedBy, "User");
  assert.equal(saved.body.contract.revision, 2);
  assert.equal(saved.body.contract.text, text);
  assert.deepEqual(getPostContract(db, swarm.id, post.id), saved.body.contract);
  const recipients = db.sql
    .prepare("SELECT name FROM message_recipients WHERE swarm_id = ? ORDER BY name")
    .all(swarm.id);
  assert.deepEqual(
    recipients.map((row) => row.name),
    ["John", "Maria"],
  );
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM post_subscriptions WHERE post_id = ?").get(post.id)?.n, 1);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM comments WHERE post_id = ?").get(post.id)?.n, 0);
  const detail = await getJson<PostDetailResponse>(`${board.base}/api/swarms/${swarm.id}/posts/${post.id}`);
  assert.equal(detail.body.post.text, "Original post body.");
  assert.deepEqual(detail.body.contract, saved.body.contract);
  const stale = await postJson(endpoint, { text: "Stale overwrite", expectedRevision: 1 });
  assert.equal(stale.status, 409);
  assert.equal(getPostContract(db, swarm.id, post.id)?.text, text);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM message_recipients WHERE swarm_id = ?").get(swarm.id)?.n, 2);
});

it("allows a User to create an optional document without impersonating an agent", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { db } = board.temp;
  const swarm = seedSwarm(db);
  const post = createPost(db, swarm.id, "Liam", { title: "No contract yet", text: "Optional." }, Date.now());
  const result = await postJson<{ contract: PostContract }>(
    `${board.base}/api/swarms/${swarm.id}/posts/${post.id}/contract`,
    {
      text: "User-created agreement",
      expectedRevision: 0,
    },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.contract.updatedBy, "User");
  assert.equal(result.body.contract.revision, 1);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM messages WHERE swarm_id = ?").get(swarm.id)?.n, 0);
});

it("rejects invalid revisions, blank documents and cross-swarm writes without mutation", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { db } = board.temp;
  const swarm = seedSwarm(db);
  const other = seedSwarm(db);
  const post = createPost(db, swarm.id, "Liam", { title: "Local", text: "Local post." }, Date.now());
  const foreign = createPost(db, other.id, "Liam", { title: "Foreign", text: "Other post." }, Date.now());
  const base = `${board.base}/api/swarms/${swarm.id}/posts`;
  for (const request of [
    { text: "No revision" },
    { text: "Negative", expectedRevision: -1 },
    { text: "Fractional", expectedRevision: 0.5 },
    { text: "  \n ", expectedRevision: 0 },
    { expectedRevision: 0 },
  ]) {
    assert.equal((await postJson(`${base}/${post.id}/contract`, request)).status, 400);
  }
  assert.equal(
    (await postJson(`${base}/${foreign.id}/contract`, { text: "Wrong swarm", expectedRevision: 0 })).status,
    404,
  );
  assert.equal(getPostContract(db, swarm.id, post.id), null);
  assert.equal(getPostContract(db, other.id, foreign.id), null);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM messages WHERE swarm_id = ?").get(swarm.id)?.n, 0);
});
