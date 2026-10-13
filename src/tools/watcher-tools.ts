import type { SessionAssistantTextItem, SessionToolCallItem } from "../api-types.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { systemClock } from "../clock.js";
import { WATCHER_ACTIVITY_DEFAULT, WATCHER_ACTIVITY_MAX, WATCHER_OVERVIEW_POSTS, WATCHER_TOOL } from "../constants.js";
import { BrokerError } from "../broker/errors.js";
import { checkPage, requireSwarm } from "../broker/validate.js";
import { SessionReader } from "../server/sessions.js";
import { getAcceptance } from "../store/acceptance-queries.js";
import { getThread, listThreads } from "../store/message-queries.js";
import { getStats } from "../store/stats-queries.js";
import { getSwarm, listAgentSessions, listParticipants } from "../store/swarm-queries.js";
import { listPosts } from "../store/wall-queries.js";
import { timeAgo } from "../wall-format.js";
import { formatThread } from "./agent-tool-format.js";
import { agentToolResult } from "./agent-tool-result.js";
import type { AgentToolIdentity } from "./agent-tools.js";
import { activityLine, compactText, formatActivity } from "./watcher-digest.js";

async function lastActivity(reader: SessionReader, agent: { name: string; sessionFile: string }) {
  let text: SessionAssistantTextItem | undefined;
  let tool: SessionToolCallItem | undefined;
  let before: string | undefined;
  let timestamp = 0;
  do {
    const page = await reader.readPage(agent.name, agent.sessionFile, { before, limit: WATCHER_ACTIVITY_MAX });
    timestamp = Math.max(timestamp, page.items[0]?.timestamp ?? 0);
    text ??= page.items.find((item) => item.kind === "assistant_text");
    tool ??= page.items.find((item) => item.kind === "tool_call");
    before = page.olderCursor ?? undefined;
  } while (before !== undefined && (!text || !tool));
  return { text, tool, timestamp };
}

export function createWatcherToolHandlers(identity: AgentToolIdentity) {
  const reader = new SessionReader({ maxToolOutputChars: 0 });
  const clock = identity.clock ?? systemClock;
  function session(agent: string) {
    const found = listAgentSessions(identity.getDb(), identity.swarmId).find(
      (item) => item.name.toLowerCase() === agent.toLowerCase(),
    );
    if (!found) throw new BrokerError("not_found", `Agent "${agent}" not found.`);
    return found;
  }
  return {
    async overview(): Promise<string> {
      const db = identity.getDb();
      const now = clock.now();
      const swarm = getSwarm(db, identity.swarmId, now);
      if (!swarm) throw new BrokerError("not_found", "Swarm not found.");
      const stats = getStats(db, swarm.id, now);
      const participants = listParticipants(db, swarm.id);
      const blocks = await Promise.all(
        listAgentSessions(db, swarm.id).map(async (agent) => {
          const { text, tool, timestamp } = await lastActivity(reader, agent);
          const participant = participants.find((item) => item.name === agent.name);
          const usage = stats?.agents.find((item) => item.name === agent.name);
          const rawStatus = participant?.kind === "agent" ? participant.status : "stopped";
          const running = swarm.status === "running" || swarm.status === "starting";
          const status =
            rawStatus === "crashed" ? "crashed" : !running ? "stopped" : rawStatus === "working" ? "busy" : rawStatus;
          const latest = Math.max(participant?.lastActivityAt ?? 0, timestamp);
          const current =
            participant?.kind === "agent" && participant.activity?.kind === "tool"
              ? participant.activity.toolName
              : null;
          return [
            `${agent.name}: ${status}; activity ${latest ? timeAgo(latest, now) : "none"}; turns ${usage?.turns ?? 0}; cost $${(usage?.cost ?? 0).toFixed(4)}`,
            tool?.kind === "tool_call" && (!current || tool.name === current)
              ? activityLine(tool)
              : `tool: ${current ?? "none"}`,
            `assistant: ${text?.kind === "assistant_text" ? compactText(text.text) : "none"}`,
          ].join("\n");
        }),
      );
      const wall = listPosts(db, swarm.id, { count: WATCHER_OVERVIEW_POSTS, offset: 0 });
      return [
        `Swarm "${swarm.name}": ${swarm.status}; acceptance ${getAcceptance(db, swarm.id).verdict}; wall posts ${wall.total}`,
        `Goal: ${compactText(swarm.taskPrompt)}`,
        `Newest posts: ${wall.posts.map((post) => `#${post.id} ${compactText(post.title)}`).join("; ") || "none"}`,
        ...blocks,
      ].join("\n\n");
    },
    async activity(params: { agent: string; count?: number; before?: string }): Promise<string> {
      const count = params.count ?? WATCHER_ACTIVITY_DEFAULT;
      if (!Number.isInteger(count) || count < 1 || count > WATCHER_ACTIVITY_MAX)
        throw new BrokerError("validation", `count must be 1–${WATCHER_ACTIVITY_MAX}.`, "count");
      const agent = session(params.agent);
      const page = await reader.readPage(agent.name, agent.sessionFile, { limit: count, before: params.before });
      return `${agent.name}, newest first:\n${formatActivity(page.items)}\nNext cursor: ${page.olderCursor ?? "none"}`;
    },
    threads(params: { thread_id?: number; count?: number; offset?: number }): string {
      const db = identity.getDb();
      requireSwarm(db, identity.swarmId);
      if (params.thread_id !== undefined) {
        const thread = getThread(db, identity.swarmId, params.thread_id);
        if (!thread) throw new BrokerError("not_found", `Thread #${params.thread_id} not found.`);
        return formatThread(thread, identity.agentName, clock.now());
      }
      const page = { count: params.count ?? WATCHER_ACTIVITY_DEFAULT, offset: params.offset ?? 0 };
      checkPage(page);
      const threads = listThreads(db, identity.swarmId, page);
      return (
        threads.map((thread) => `#${thread.id}: ${thread.members.join(", ")}`).join("\n") || "No threads in this page."
      );
    },
  };
}

export function registerWatcherTools(pi: Pick<ExtensionAPI, "registerTool">, identity: AgentToolIdentity): void {
  const run = createWatcherToolHandlers(identity);
  pi.registerTool({
    name: WATCHER_TOOL.overview,
    label: "Swarm overview",
    description: "Compact states, activity, costs, acceptance and newest wall titles. Start here.",
    parameters: Type.Object({}),
    async execute() {
      return agentToolResult(await run.overview());
    },
  });
  pi.registerTool({
    name: WATCHER_TOOL.activity,
    label: "Agent activity",
    description:
      "Newest-first assistant texts, tool call one-liners and errors, never tool outputs. Count is session entries; pass Next cursor as before.",
    parameters: Type.Object({
      agent: Type.String(),
      count: Type.Optional(Type.Integer({ minimum: 1, maximum: WATCHER_ACTIVITY_MAX })),
      before: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      return agentToolResult(await run.activity(params));
    },
  });
  pi.registerTool({
    name: WATCHER_TOOL.threads,
    label: "Swarm threads",
    description:
      "List all swarm threads newest first, including agent-to-agent. Supply thread_id to read one. Read-only.",
    parameters: Type.Object({
      thread_id: Type.Optional(Type.Integer()),
      count: Type.Optional(Type.Integer()),
      offset: Type.Optional(Type.Integer()),
    }),
    async execute(_id, params) {
      return agentToolResult(run.threads(params));
    },
  });
}
