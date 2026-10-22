// The swarm_* tools of an agent process. They call the broker directly on PI_SWARM_DB, always as
// this agent; a BrokerError is thrown as is so its exact message becomes the tool error.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { systemClock, type Clock } from "../clock.js";
import { AGENT_TOOL, PAGE_DEFAULT_COUNT, PAGE_MAX_COUNT, WATCHER_NAME } from "../constants.js";
import { TITLE_MAX } from "../limits.js";
import { BrokerError } from "../broker/errors.js";
import { replyToThread, readThreadAs, sendMessage } from "../broker/messages.js";
import { addComment, createPost } from "../broker/wall.js";
import { setPostSubscription } from "../broker/subscriptions.js";
import type { SwarmDb } from "../store/db.js";
import { getPostDetail } from "../store/wall-queries.js";
import { formatPostDetail, formatSent, formatThread } from "./agent-tool-format.js";
import { acceptanceToolDescription, acceptanceToolParameters, executeAcceptanceTool } from "./acceptance-tool.js";
import { readWallTool } from "./wall-read.js";
import { agentToolResult as textResult } from "./agent-tool-result.js";

export interface AgentToolIdentity {
  getDb(): SwarmDb;
  swarmId: number;
  run: number;
  agentName: string;
  clock?: Clock;
}

const BRIEF = "Be extremely brief and focused.";
const bodyRule = (bodyMaxChars: number) =>
  `At most ${bodyMaxChars} chars; put longer material in a file and share its path.`;

const READ_POSTS = Type.Object({
  count: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: PAGE_MAX_COUNT,
      description: `Posts or changes to show, 1–${PAGE_MAX_COUNT} (default ${PAGE_DEFAULT_COUNT}).`,
    }),
  ),
  offset: Type.Optional(
    Type.Integer({ minimum: 0, description: "Skip this many newest posts (default 0); ignored with after." }),
  ),
  after: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Opaque next cursor from a wall read; returns post and comment changes oldest first. Takes precedence over offset.",
    }),
  ),
});
const READ_POST = Type.Object({ post_id: Type.Integer({ minimum: 1 }) });
// Length checks follow trimming in the broker; raw schema maxima would reject valid padded input.
const TEXT = Type.String({
  minLength: 1,
  pattern: "\\S",
  description: "Plain text; follow the stated body limit in the tool description.",
});
const POST = Type.Object({
  title: Type.String({ minLength: 1, pattern: "\\S", description: `Max ${TITLE_MAX} chars.` }),
  text: TEXT,
});
const COMMENT = Type.Object({ post_id: Type.Integer({ minimum: 1 }), text: TEXT });
const SUBSCRIPTION = Type.Object({ post_id: Type.Integer({ minimum: 1 }) });
const MESSAGE = Type.Object({
  to: Type.Array(Type.String({ minLength: 1, pattern: "\\S" }), {
    minItems: 1,
    description: 'Participant names from the wall; "User" is the human.',
  }),
  text: TEXT,
});
const REPLY_TO = Type.Object({ thread_id: Type.Integer({ minimum: 1 }), text: TEXT });
const READ_THREAD = Type.Object({ thread_id: Type.Integer({ minimum: 1 }) });

/** The tool bodies, returning the model-facing text. Separate from registration so tests need no pi. */
export function createAgentToolHandlers(identity: AgentToolIdentity) {
  const { swarmId, agentName } = identity;
  const clock = identity.clock ?? systemClock;
  return {
    readPosts(params: Static<typeof READ_POSTS>): string {
      return readWallTool(identity.getDb(), swarmId, agentName, params, clock.now());
    },
    readPost(params: Static<typeof READ_POST>): string {
      const detail = getPostDetail(identity.getDb(), swarmId, params.post_id);
      if (detail === null) throw new BrokerError("not_found", `Post #${params.post_id} not found.`);
      return formatPostDetail(detail, clock.now());
    },
    post(params: Static<typeof POST>): string {
      const post = createPost(identity.getDb(), swarmId, agentName, params, clock.now());
      return `Posted #${post.id}.`;
    },
    comment(params: Static<typeof COMMENT>): string {
      const { comment } = addComment(identity.getDb(), swarmId, agentName, params.post_id, params.text, clock.now());
      return `Commented #${comment.id} on post #${comment.postId}.`;
    },
    subscribe(params: Static<typeof SUBSCRIPTION>, subscribed = true): string {
      setPostSubscription(identity.getDb(), swarmId, agentName, params.post_id, subscribed, clock.now());
      return `${subscribed ? "Subscribed to" : "Unsubscribed from"} post #${params.post_id}.`;
    },
    message(params: Static<typeof MESSAGE>): string {
      const message = sendMessage(identity.getDb(), swarmId, agentName, params.to, params.text, clock.now());
      return formatSent(message, "Sent");
    },
    replyTo(params: Static<typeof REPLY_TO>): string {
      const message = replyToThread(identity.getDb(), swarmId, agentName, params.thread_id, params.text, clock.now());
      return formatSent(message, "Replied");
    },
    readThread(params: Static<typeof READ_THREAD>): string {
      const thread = readThreadAs(identity.getDb(), swarmId, agentName, params.thread_id);
      return formatThread(thread, agentName, clock.now());
    },
    acceptance(params: Static<typeof acceptanceToolParameters>): string {
      return JSON.stringify(
        executeAcceptanceTool(identity.getDb(), swarmId, agentName, params, clock.now(), identity.run),
      );
    },
  };
}

/** `bodyMaxChars` is the stated limit; the broker quietly tolerates more (see `bodyCeiling`). */
export function registerAgentTools(
  pi: Pick<ExtensionAPI, "registerTool">,
  identity: AgentToolIdentity,
  bodyMaxChars: number,
): void {
  const run = createAgentToolHandlers(identity);
  const limit = bodyRule(bodyMaxChars);
  const watcher = identity.agentName === WATCHER_NAME;
  pi.registerTool({
    name: AGENT_TOOL.readPosts,
    label: "Read wall",
    description: watcher
      ? "Read wall posts or changes after a cursor, with body previews."
      : "Read the wall newest first, with new posts marked. Optional after returns post/comment changes oldest first; reuse Next cursor for subsequent pages. The initial history cursor starts at the beginning, so unseen older history is not skipped. Bodies are previews; read a post for full text. Check what the others are doing and find the next useful work until the whole task is accepted.",
    promptSnippet: "Read wall history or post/comment changes after a cursor.",
    parameters: READ_POSTS,
    async execute(_toolCallId, params) {
      return textResult(run.readPosts(params));
    },
  });
  pi.registerTool({
    name: AGENT_TOOL.readPost,
    label: "Read post",
    description: "Read one wall post with all its comments, oldest first.",
    promptSnippet: "Read one wall post with its comments.",
    parameters: READ_POST,
    async execute(_toolCallId, params) {
      return textResult(run.readPost(params));
    },
  });
  pi.registerTool({
    name: AGENT_TOOL.post,
    label: "Post",
    description: watcher
      ? `Post to the wall only when the human asks. ${limit}`
      : `Post to the swarm wall: what you take, progress and finished work. Then check the wall and pick up the next useful work until the whole task is accepted. ${BRIEF} Title max ${TITLE_MAX} chars. ${limit} Plain text, no markdown.`,
    promptSnippet: "Post a short plan or status to the swarm wall.",
    parameters: POST,
    async execute(_toolCallId, params) {
      return textResult(run.post(params));
    },
  });
  pi.registerTool({
    name: AGENT_TOOL.comment,
    label: "Comment",
    description: `Comment on a wall post. Authors and commenters subscribe automatically unless explicitly unsubscribed. Subscribers receive new comment text, except their own. ${BRIEF} ${limit} Plain text.`,
    promptSnippet: "Comment on a wall post.",
    parameters: COMMENT,
    async execute(_toolCallId, params) {
      return textResult(run.comment(params));
    },
  });
  for (const subscribed of [true, false]) {
    pi.registerTool({
      name: subscribed ? AGENT_TOOL.subscribe : AGENT_TOOL.unsubscribe,
      label: subscribed ? "Subscribe" : "Unsubscribe",
      promptSnippet: subscribed ? "Subscribe to future post comments." : "Stop post comment notifications.",
      description: subscribed
        ? "Subscribe to future comments on a post. New comment text arrives through queued steering; use history or only-new reads for earlier comments."
        : "Stop future comment notifications for a post, even if you comment again. Removes unsent notifications; already accepted steering may still arrive. Explicit subscribe reverses this opt-out.",
      parameters: SUBSCRIPTION,
      async execute(_toolCallId, params) {
        return textResult(run.subscribe(params, subscribed));
      },
    });
  }
  pi.registerTool({
    name: AGENT_TOOL.message,
    label: "Message",
    description: `Start a new message thread with the given participants (names from the wall, or "User" for the human). They are woken up with it. ${BRIEF} ${limit} Never wait for an answer.`,
    promptSnippet: "Message other agents or the User in a new thread.",
    parameters: MESSAGE,
    async execute(_toolCallId, params) {
      return textResult(run.message(params));
    },
  });
  pi.registerTool({
    name: AGENT_TOOL.replyTo,
    label: "Reply",
    description: `Reply to every other member of a thread you are in. ${BRIEF} ${limit}`,
    promptSnippet: "Reply in a message thread.",
    parameters: REPLY_TO,
    async execute(_toolCallId, params) {
      return textResult(run.replyTo(params));
    },
  });
  pi.registerTool({
    name: AGENT_TOOL.readThread,
    label: "Read thread",
    description: "Read the full history of a message thread you are in, e.g. after a context compaction.",
    promptSnippet: "Read the full history of a message thread.",
    parameters: READ_THREAD,
    async execute(_toolCallId, params) {
      return textResult(run.readThread(params));
    },
  });
  if (identity.agentName === WATCHER_NAME) return;
  pi.registerTool({
    name: AGENT_TOOL.acceptance,
    label: "Acceptance",
    description: acceptanceToolDescription,
    promptSnippet: "Inspect criteria and votes, or vote on the whole task with a reason.",
    parameters: acceptanceToolParameters,
    async execute(_toolCallId, params) {
      return textResult(run.acceptance(params));
    },
  });
}
