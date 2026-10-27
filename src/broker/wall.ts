// Wall writes and per-reader "(new)" marks. Posts wake agents only through explicit mentions.
import type { CommentView, PostSummary } from "../api-types.js";
import type { SwarmDb } from "../store/db.js";
import { insertEvent } from "../store/events.js";
import { commentOf, count } from "../store/rows.js";
import { getPost } from "../store/wall-queries.js";
import { storedBody } from "./attachment.js";
import { BrokerError } from "./errors.js";
import { autoSubscribe, notifyComment } from "./subscriptions.js";
import { emitUserPostAttention } from "./user-post-subscription.js";
import { notifyLocalMessage } from "./notify.js";
import { notifyWallMentions } from "./mentions.js";
import { actAs, requireSwarm, requireTitle } from "./validate.js";

export function createPost(
  db: SwarmDb,
  swarmId: number,
  author: string,
  input: { title: string; text: string },
  now: number,
): PostSummary {
  const result = db.write(() => {
    requireSwarm(db, swarmId);
    const participant = actAs(db, swarmId, author, now);
    const title = requireTitle(input.title);
    const body = storedBody(db, swarmId, "post", input.text, participant.kind);
    const postId = count(
      db.sql
        .prepare("INSERT INTO posts (swarm_id, author, title, body, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(swarmId, participant.name, title, body, now).lastInsertRowid,
    );
    const post: PostSummary = {
      id: postId,
      swarmId,
      author: participant.name,
      title,
      text: body,
      commentCount: 0,
      createdAt: now,
    };
    const subscribed = autoSubscribe(db, swarmId, postId, participant.name);
    insertEvent(db, swarmId, "post.created", { post }, now);
    if (subscribed && participant.kind === "user") emitUserPostAttention(db, swarmId, postId, now);
    notifyWallMentions(
      db,
      swarmId,
      { postId, author: participant.name, text: `${title}\n${body}`, mentionText: `${title}\n${input.text}` },
      now,
    );
    return post;
  });
  notifyLocalMessage(swarmId);
  return result;
}

export function addComment(
  db: SwarmDb,
  swarmId: number,
  author: string,
  postId: number,
  text: string,
  now: number,
): { comment: CommentView; commentCount: number } {
  const result = db.write(() => {
    requireSwarm(db, swarmId);
    const participant = actAs(db, swarmId, author, now);
    const post = getPost(db, swarmId, postId);
    if (post === null) throw new BrokerError("not_found", `Post #${postId} not found.`);
    const body = storedBody(db, swarmId, "comment", text, participant.kind);
    const commentId = count(
      db.sql
        .prepare("INSERT INTO comments (post_id, swarm_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(postId, swarmId, participant.name, body, now).lastInsertRowid,
    );
    const row = db.sql.prepare("SELECT * FROM comments WHERE id = ?").get(commentId);
    if (row === undefined) throw new Error(`Comment #${commentId} vanished inside its transaction`);
    const result = { comment: commentOf(row), commentCount: post.commentCount + 1 };
    const subscribed = autoSubscribe(db, swarmId, postId, participant.name);
    const mentioned = notifyWallMentions(
      db,
      swarmId,
      { postId, commentId, author: participant.name, text: body, mentionText: text },
      now,
    );
    const userNotified = notifyComment(db, result.comment, now, mentioned);
    insertEvent(db, swarmId, "comment.created", result, now);
    if (userNotified || (subscribed && participant.kind === "user")) emitUserPostAttention(db, swarmId, postId, now);
    return result;
  });
  notifyLocalMessage(swarmId);
  return result;
}
