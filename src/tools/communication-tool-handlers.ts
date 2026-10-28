import { WATCHER_NAME } from "../constants.js";
import { BrokerError } from "../broker/errors.js";
import type { Static } from "typebox";
import * as S from "./agent-schemas.js";
import { cursorAfter, nextCursor, workInput, writeAgentTool, type AgentToolIdentity } from "./agent-tool-context.js";
import { createPost, addComment } from "../broker/wall.js";
import { getPostPage } from "../broker/post-queries.js";
import { updatePostLinks } from "../broker/post-links.js";
import { setPostSubscription } from "../broker/subscriptions.js";

export function createCommunicationHandlers(identity: AgentToolIdentity) {
  const db = () => identity.getDb();
  const input = () => workInput(identity);
  const { swarmId, agentName } = identity;
  const subscriptionText = (postId: number) => {
    const row = db()
      .sql.prepare("SELECT subscribed FROM post_subscriptions WHERE post_id = ? AND name = ?")
      .get(postId, agentName);
    return row?.subscribed === 1
      ? `You are subscribed to post #${postId}; unsubscribe with swarm_posts_unsubscribe.`
      : `You are not subscribed to post #${postId}.`;
  };
  return {
    postsCreate(params: Static<typeof S.postsCreate> & Static<typeof S.watcherPostsCreate>) {
      const post = writeAgentTool(identity, () => {
        const post = createPost(
          db(),
          swarmId,
          agentName,
          { title: params.title, text: params.body, broadcast: params.broadcast },
          input().now,
        );
        if ((params.task_ids?.length ?? 0) + (params.criterion_ids?.length ?? 0) > 0) {
          if (agentName === WATCHER_NAME) throw new BrokerError("validation", "Watcher cannot change work links.");
          updatePostLinks(db(), {
            ...input(),
            postId: post.id,
            taskIds: params.task_ids,
            criterionIds: params.criterion_ids,
          });
        }
        return post;
      });
      return `Post #${post.id} [published]. ${subscriptionText(post.id)}`;
    },
    postsGet(params: Static<typeof S.tasksGet>) {
      return db().read(() => {
        const scope = `post:${swarmId}:${params.id}`;
        const result = getPostPage(db(), swarmId, params.id, cursorAfter(params.cursor, scope), params.limit);
        return `${JSON.stringify(result)}\nNext cursor: ${nextCursor(result.nextAfter, scope) ?? "none"}`;
      });
    },
    postsComment(params: Static<typeof S.postsComment>) {
      const { comment } = writeAgentTool(identity, () =>
        addComment(db(), swarmId, agentName, params.post_id, params.body, input().now),
      );
      return `Comment #${comment.id} [published]. ${subscriptionText(comment.postId)}`;
    },
    postsUnsubscribe({ post_id }: Static<typeof S.postId>) {
      writeAgentTool(identity, () => setPostSubscription(db(), swarmId, agentName, post_id, false, input().now));
      return `Unsubscribed from post #${post_id}.`;
    },
    postsLink(params: Static<typeof S.postsLink>, remove = false) {
      const result = updatePostLinks(db(), {
        ...input(),
        postId: params.post_id,
        taskIds: params.task_ids,
        criterionIds: params.criterion_ids,
        remove,
      });
      return `Post #${result.id} [${remove ? "unlinked" : "linked"}]. ${result.links.length} links.`;
    },
  };
}
