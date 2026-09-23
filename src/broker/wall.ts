// Wall writes: posts, comments and the per-reader "(new)" marks. Posts never wake anyone.
import type { CommentView, PostListResponse, PostSummary } from "../api-types.js";
import type { SwarmDb } from "../store/db.js";
import { insertEvent } from "../store/events.js";
import { commentOf, count, int } from "../store/rows.js";
import { getPost, listPosts } from "../store/wall-queries.js";
import { BrokerError } from "./errors.js";
import { actAs, checkPage, requireParticipant, requireSwarm, requireText, requireTitle } from "./validate.js";

export function createPost(
  db: SwarmDb,
  swarmId: number,
  author: string,
  input: { title: string; text: string },
  now: number,
): PostSummary {
  return db.write(() => {
    requireSwarm(db, swarmId);
    const participant = actAs(db, swarmId, author, now);
    const title = requireTitle(input.title);
    const body = requireText(input.text);
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
    insertEvent(db, swarmId, "post.created", { post }, now);
    return post;
  });
}

export function addComment(
  db: SwarmDb,
  swarmId: number,
  author: string,
  postId: number,
  text: string,
  now: number,
): { comment: CommentView; commentCount: number } {
  return db.write(() => {
    requireSwarm(db, swarmId);
    const participant = actAs(db, swarmId, author, now);
    const post = getPost(db, swarmId, postId);
    if (post === null) throw new BrokerError("not_found", `Post #${postId} not found.`);
    const body = requireText(text);
    const commentId = count(
      db.sql
        .prepare("INSERT INTO comments (post_id, swarm_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(postId, swarmId, participant.name, body, now).lastInsertRowid,
    );
    const row = db.sql.prepare("SELECT * FROM comments WHERE id = ?").get(commentId);
    if (row === undefined) throw new Error(`Comment #${commentId} vanished inside its transaction`);
    const result = { comment: commentOf(row), commentCount: post.commentCount + 1 };
    insertEvent(db, swarmId, "comment.created", result, now);
    return result;
  });
}

/**
 * A page of the wall as `reader` sees it. "New" = newer than the reader's mark and not its own; the mark
 * only moves forward, to the newest post of the page.
 */
export function readPostsAs(
  db: SwarmDb,
  swarmId: number,
  reader: string,
  page: { count: number; offset: number },
): { page: PostListResponse; newPostIds: number[] } {
  checkPage(page);
  return db.write(() => {
    requireSwarm(db, swarmId);
    const participant = requireParticipant(db, swarmId, reader);
    const markRow = db.sql
      .prepare("SELECT last_post_id FROM read_marks WHERE swarm_id = ? AND name = ?")
      .get(swarmId, participant.name);
    const mark = markRow === undefined ? 0 : int(markRow, "last_post_id");
    const list = listPosts(db, swarmId, page);
    const newPostIds = list.posts.filter((post) => post.id > mark && post.author !== participant.name).map((p) => p.id);
    const newest = Math.max(mark, ...list.posts.map((post) => post.id));
    if (newest > mark) {
      db.sql
        .prepare(
          `INSERT INTO read_marks (swarm_id, name, last_post_id) VALUES (?, ?, ?)
           ON CONFLICT (swarm_id, name) DO UPDATE SET last_post_id = MAX(last_post_id, excluded.last_post_id)`,
        )
        .run(swarmId, participant.name, newest);
    }
    return { page: list, newPostIds };
  });
}
