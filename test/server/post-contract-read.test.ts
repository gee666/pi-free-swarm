import assert from "node:assert/strict";
import { it } from "node:test";
import type { PostDetailResponse, PostListResponse } from "../../src/api-types.js";
import { writePostContract } from "../../src/broker/post-contracts.js";
import { createPost } from "../../src/broker/wall.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { getJson, startTestBoard } from "./helpers.js";

it("returns contract metadata on wall lists and full current text only on its post detail", async (t) => {
  const board = await startTestBoard();
  t.after(() => board.close());
  const { db } = board.temp;
  const now = Date.now();
  const swarm = seedSwarm(db, { now });
  const other = seedSwarm(db, { now });
  const post = createPost(db, swarm.id, "Maria", { title: "Contract", text: "Optional document" }, now);
  const plain = createPost(db, swarm.id, "Maria", { title: "Plain", text: "No document" }, now);
  const foreign = createPost(db, other.id, "Maria", { title: "Other swarm", text: "Separate" }, now);
  const original = writePostContract(db, swarm.id, "John", post.id, "Initial agreement", 0, now);
  const text = `${"Detailed evidence 🔬\n".repeat(40)}Final untruncated clause`;
  const updated = writePostContract(db, swarm.id, "Liam", post.id, text, original.revision, now + 1);
  const url = `${board.base}/api/swarms/${swarm.id}/posts`;
  const list = await getJson<PostListResponse>(url);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.posts.find((row) => row.id === post.id)?.contract, {
    postId: post.id,
    revision: updated.revision,
    updatedBy: "Liam",
    updatedAt: now + 1,
  });
  assert.equal(JSON.stringify(list.body).includes("Final untruncated clause"), false);
  assert.equal(list.body.posts.find((row) => row.id === plain.id)?.contract, null);
  const detail = await getJson<PostDetailResponse>(`${url}/${post.id}`);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.contract, updated);
  assert.equal(detail.body.contract?.text, text);
  assert.equal(detail.body.comments.length, 0);
  const plainDetail = await getJson<PostDetailResponse>(`${url}/${plain.id}`);
  assert.equal(plainDetail.body.contract, null);
  const foreignDetail = await getJson<PostDetailResponse>(`${board.base}/api/swarms/${other.id}/posts/${foreign.id}`);
  assert.equal(foreignDetail.body.contract, null);
  assert.equal((await getJson(`${url}/${foreign.id}`)).status, 404);
});
