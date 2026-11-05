import { USER_NAME, WATCHER_NAME } from "../constants.js";
import { checkText } from "../limits.js";
import type { SwarmDb } from "../store/db.js";
import { saveWatcherChatPost, watcherChatPostId } from "../store/watcher-chat.js";
import { BrokerError } from "./errors.js";
import { addComment, createPost } from "./wall.js";

export function sendWatcherChat(db: SwarmDb, swarmId: number, text: string, now: number): number {
  const checked = checkText(text, Infinity);
  if (!checked.ok) throw new BrokerError("validation", checked.error, "text");
  return db.write(() => {
    // Reuse wall delivery and Watcher's existing reply tools, including before a run starts.
    const body = `@${WATCHER_NAME}\n${checked.value}`;
    const postId = watcherChatPostId(db, swarmId);
    if (postId !== undefined) {
      addComment(db, swarmId, USER_NAME, postId, body, now);
      return postId;
    }
    const post = createPost(db, swarmId, USER_NAME, { title: "Watcher chat", text: body }, now);
    saveWatcherChatPost(db, swarmId, post.id);
    return post.id;
  });
}
