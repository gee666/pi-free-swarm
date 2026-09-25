// The swarm_* tools of an agent process. They call the broker directly on PI_SWARM_DB, always as
// this agent; a BrokerError is thrown as is so its exact message becomes the tool error.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { systemClock, type Clock } from "../clock.js";
import { AGENT_TOOL, PAGE_DEFAULT_COUNT, PAGE_MAX_COUNT } from "../constants.js";
import { BODY_SAFETY_MAX, TEXT_MAX, TITLE_MAX } from "../limits.js";
import { BrokerError } from "../broker/errors.js";
import { replyToThread, readThreadAs, sendMessage } from "../broker/messages.js";
import { addComment, createPost } from "../broker/wall.js";
import type { SwarmDb } from "../store/db.js";
import { getPostDetail } from "../store/wall-queries.js";
import { formatPostDetail, formatSent, formatThread } from "./agent-tool-format.js";
import { acceptanceToolDescription, acceptanceToolParameters, executeAcceptanceTool } from "./acceptance-tool.js";
import { readWallTool } from "./wall-read.js";
import { agentToolResult as textResult } from "./agent-tool-result.js";

export interface AgentToolIdentity {
  getDb(): SwarmDb;
  swarmId: number;
  agentName: string;
  clock?: Clock;
}

const BRIEF = "Be extremely brief and focused.";
const BODY_LIMIT = `Body allowance: bodyMaxChars in settings.json (default ${TEXT_MAX}, safety ceiling ${BODY_SAFETY_MAX} chars).`;
const textParam = () =>
  Type.String({ description: `Plain text. ${BODY_LIMIT} For more, write a file and give its path.` });

const READ_POSTS = Type.Object({
  count: Type.Optional(
    Type.Integer({ description: `Posts or changes to show, 1–${PAGE_MAX_COUNT} (default ${PAGE_DEFAULT_COUNT}).` }),
  ),
  offset: Type.Optional(Type.Integer({ description: "Skip this many newest posts (default 0); ignored with after." })),
  after: Type.Optional(
    Type.String({ description: "Opaque next cursor from a wall read; returns post and comment changes oldest first." }),
  ),
});
const READ_POST = Type.Object({ post_id: Type.Integer() });
const POST = Type.Object({
  title: Type.String({ description: `Max ${TITLE_MAX} chars.` }),
  text: textParam(),
});
const COMMENT = Type.Object({ post_id: Type.Integer(), text: textParam() });
const MESSAGE = Type.Object({
  to: Type.Array(Type.String(), { description: 'Participant names from the wall; "User" is the human.' }),
  text: textParam(),
});
const REPLY_TO = Type.Object({ thread_id: Type.Integer(), text: textParam() });
const READ_THREAD = Type.Object({ thread_id: Type.Integer() });

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
      return JSON.stringify(executeAcceptanceTool(identity.getDb(), swarmId, agentName, params, clock.now()));
    },
  };
}

export function registerAgentTools(pi: Pick<ExtensionAPI, "registerTool">, identity: AgentToolIdentity): void {
  const run = createAgentToolHandlers(identity);
  pi.registerTool({
    name: AGENT_TOOL.readPosts,
    label: "Read wall",
    description:
      "Read the wall newest first, with new posts marked. Optional after returns post/comment changes oldest first; reuse Next cursor for subsequent pages. The initial history cursor starts at the beginning, so unseen older history is not skipped. Bodies are previews; read a post for full text.",
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
    description: `Post to the swarm wall: plans, what you take, status. ${BRIEF} Title max ${TITLE_MAX} chars. ${BODY_LIMIT} Plain text, no markdown.`,
    promptSnippet: "Post a short plan or status to the swarm wall.",
    parameters: POST,
    async execute(_toolCallId, params) {
      return textResult(run.post(params));
    },
  });
  pi.registerTool({
    name: AGENT_TOOL.comment,
    label: "Comment",
    description: `Comment on a wall post. ${BRIEF} ${BODY_LIMIT} Plain text.`,
    promptSnippet: "Comment on a wall post.",
    parameters: COMMENT,
    async execute(_toolCallId, params) {
      return textResult(run.comment(params));
    },
  });
  pi.registerTool({
    name: AGENT_TOOL.message,
    label: "Message",
    description: `Start a new message thread with the given participants (names from the wall, or "User" for the human). They are woken up with it. ${BRIEF} ${BODY_LIMIT} Never wait for an answer.`,
    promptSnippet: "Message other agents or the User in a new thread.",
    parameters: MESSAGE,
    async execute(_toolCallId, params) {
      return textResult(run.message(params));
    },
  });
  pi.registerTool({
    name: AGENT_TOOL.replyTo,
    label: "Reply",
    description: `Reply to every other member of a thread you are in. ${BRIEF} ${BODY_LIMIT}`,
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
  pi.registerTool({
    name: AGENT_TOOL.acceptance,
    label: "Acceptance",
    description: acceptanceToolDescription,
    promptSnippet: "Inspect or update the shared task acceptance attestation.",
    parameters: acceptanceToolParameters,
    async execute(_toolCallId, params) {
      return textResult(run.acceptance(params));
    },
  });
}
