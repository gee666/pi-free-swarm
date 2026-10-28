import { COMMENT_NOTICE_CHARS, USER_NAME } from "../constants.js";
import { mentionedNames } from "../mentions.js";
import type { SwarmDb } from "../store/db.js";
import { text } from "../store/rows.js";
import { notifyWork } from "./work-notifications.js";

interface WallMention {
  postId: number;
  commentId?: number;
  title: string;
  author: string;
  text: string;
  mentionText: string;
}

export function notifyWallMentions(
  db: SwarmDb,
  swarmId: number,
  source: WallMention,
  now: number,
  broadcastRecipients: readonly string[] = [],
): string[] {
  const names = db.sql
    .prepare("SELECT name FROM participants WHERE swarm_id = ? AND kind IN ('agent', 'user')")
    .all(swarmId)
    .map((row) => text(row, "name"));
  const recipients = mentionedNames(source.mentionText, names).filter(
    (name) => name.toLowerCase() !== source.author.toLowerCase(),
  );
  const preview = Array.from(source.text.trim()).slice(0, COMMENT_NOTICE_CHARS).join("");
  for (const name of recipients) {
    if (name === USER_NAME) {
      if (source.commentId === undefined) {
        db.sql
          .prepare("INSERT OR IGNORE INTO user_post_attention (swarm_id, post_id) VALUES (?, ?)")
          .run(swarmId, source.postId);
      } else {
        db.sql
          .prepare(
            `INSERT INTO user_comment_attention (comment_id, swarm_id, post_id, mentioned) VALUES (?, ?, ?, 1)
          ON CONFLICT (comment_id) DO UPDATE SET mentioned = 1`,
          )
          .run(source.commentId, swarmId, source.postId);
      }
    } else if (!broadcastRecipients.includes(name)) {
      notifyWork(
        db,
        swarmId,
        name,
        `${source.author} mentioned you in ${source.commentId === undefined ? "post" : "comment on post"} #${source.postId} "${source.title}": ${preview}. Read with swarm_posts_get.`,
        now,
      );
    }
  }
  return recipients;
}
