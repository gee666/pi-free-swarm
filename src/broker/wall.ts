// Wall writes notify mentions and subscribers; work-link notifications live in post-links.
import type { CommentView, PostSummary } from "../api-types.js";
import { USER_POST_NOTICE_CHARS, USER_NAME, WATCHER_NAME } from "../constants.js";
import { workRoster } from "../store/work-roster.js";
import { notifyWork } from "./work-notifications.js";
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
  input: { title: string; text: string; broadcast?: unknown },
  now: number,
): PostSummary {
  const result = db.write(() => {
    requireSwarm(db, swarmId);
    const participant = actAs(db, swarmId, author, now);
    if (input.broadcast !== undefined && typeof input.broadcast !== "boolean")
      throw new BrokerError("validation", "broadcast must be true or false.", "broadcast");
    const broadcast = input.broadcast === true;
    if (broadcast && participant.name !== USER_NAME && participant.name !== WATCHER_NAME)
      throw new BrokerError("validation", "Only User and Watcher can broadcast posts.", "broadcast");
    const title = requireTitle(input.title);
    const body = storedBody(db, swarmId, "post", input.text, participant.kind);
    const postId = count(
      db.sql
        .prepare("INSERT INTO posts (swarm_id, author, title, body, created_at, broadcast) VALUES (?, ?, ?, ?, ?, ?)")
        .run(swarmId, participant.name, title, body, now, Number(broadcast)).lastInsertRowid,
    );
    const post: PostSummary = {
      id: postId,
      swarmId,
      author: participant.name,
      title,
      text: body,
      broadcast,
      commentCount: 0,
      createdAt: now,
    };
    const subscribed = autoSubscribe(db, swarmId, postId, participant.name);
    insertEvent(db, swarmId, "post.created", { post }, now);
    if (subscribed && participant.kind === "user") emitUserPostAttention(db, swarmId, postId, now);
    const broadcastRecipients = broadcast
      ? workRoster(db, swarmId)
          .filter((agent) => agent.active)
          .map((agent) => agent.name)
      : [];
    const mentioned = notifyWallMentions(
      db,
      swarmId,
      {
        postId,
        title,
        author: participant.name,
        text: input.text,
        mentionText: `${title}\n${input.text}`,
      },
      now,
      broadcastRecipients,
    );
    if (mentioned.includes(USER_NAME)) emitUserPostAttention(db, swarmId, postId, now);
    if (broadcast) {
      const preview = Array.from(input.text.trim()).slice(0, USER_POST_NOTICE_CHARS).join("");
      for (const name of broadcastRecipients) {
        notifyWork(
          db,
          swarmId,
          name,
          `${participant.name} broadcast post #${postId} "${title}": ${preview}. Read it with swarm_posts_get.${mentioned.includes(name) ? " You are mentioned." : ""}`,
          now,
        );
      }
    }
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
      { postId, commentId, title: post.title, author: participant.name, text, mentionText: text },
      now,
    );
    const userNotified = notifyComment(db, result.comment, post.title, now, mentioned);
    insertEvent(db, swarmId, "comment.created", result, now);
    if (userNotified || mentioned.includes(USER_NAME) || (subscribed && participant.kind === "user"))
      emitUserPostAttention(db, swarmId, postId, now);
    return result;
  });
  notifyLocalMessage(swarmId);
  return result;
}
