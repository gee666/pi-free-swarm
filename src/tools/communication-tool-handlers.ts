import type { Static } from "typebox";
import * as S from "./agent-schemas.js";
import { cursorAfter, nextCursor, workInput, type AgentToolIdentity } from "./agent-tool-context.js";
import { createPost, addComment } from "../broker/wall.js";
import { getPostPage } from "../broker/post-queries.js";
import { updatePostLinks } from "../broker/post-links.js";
import { setPostSubscription } from "../broker/subscriptions.js";
import { sendMessage, readConversation } from "../broker/messages.js";

export function createCommunicationHandlers(identity: AgentToolIdentity) {
  const db = () => identity.getDb();
  const input = () => workInput(identity);
  const { swarmId, agentName } = identity;
  return {
    postsCreate(params: Static<typeof S.postsCreate>) {
      const post = db().write(() => {
        const post = createPost(db(), swarmId, agentName, { title: params.title, text: params.body }, input().now);
        updatePostLinks(db(), {
          ...input(),
          postId: post.id,
          taskIds: params.task_ids,
          criterionIds: params.criterion_ids,
        });
        return post;
      });
      return `Post #${post.id} [published]. Subscribed to post #${post.id}.`;
    },
    postsGet(params: Static<typeof S.tasksGet>) {
      const scope = `post:${swarmId}:${params.id}`;
      const result = getPostPage(db(), swarmId, params.id, cursorAfter(params.cursor, scope), params.limit);
      return `${JSON.stringify(result)}\nNext cursor: ${nextCursor(result.nextAfter, scope) ?? "none"}`;
    },
    postsComment(params: Static<typeof S.postsComment>) {
      const { comment } = addComment(db(), swarmId, agentName, params.post_id, params.body, input().now);
      return `Comment #${comment.id} [published]. Subscribed to post #${comment.postId}.`;
    },
    postsUnsubscribe({ post_id }: Static<typeof S.postId>) {
      setPostSubscription(db(), swarmId, agentName, post_id, false, input().now);
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
    messagesSend(params: Static<typeof S.messagesSend>) {
      const message = sendMessage(db(), {
        swarmId,
        from: agentName,
        to: params.to,
        text: params.body,
        now: input().now,
      });
      return `Message #${message.id} [sent] to ${message.recipients[0]?.name}. Conversation #${message.threadId}.`;
    },
    messagesRead(params: Static<typeof S.messagesRead>) {
      const scope = `conversation:${swarmId}:${agentName}:${params.with.toLowerCase()}`;
      const result = readConversation(db(), {
        swarmId,
        a: agentName,
        b: params.with,
        after: cursorAfter(params.cursor, scope),
      });
      return `${JSON.stringify(result)}\nNext cursor: ${nextCursor(result.nextAfter, scope) ?? "none"}`;
    },
  };
}
