import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { systemClock } from "../clock.js";
import {
  PAGE_MAX_COUNT,
  WATCHER_ACTIVITY_DEFAULT,
  WATCHER_ACTIVITY_MAX,
  WATCHER_OVERVIEW_POSTS,
  WATCHER_TOOL,
} from "../constants.js";
import { BrokerError } from "../broker/errors.js";
import { checkPage, requireSwarm } from "../broker/validate.js";
import { SessionReader } from "../server/sessions.js";
import { readRecentActivity } from "../server/session-recent.js";
import { getAcceptance } from "../store/acceptance-queries.js";
import { listThreads } from "../store/message-queries.js";
import { getStats } from "../store/stats-queries.js";
import { getSwarm, listAgentSessions, listParticipants } from "../store/swarm-queries.js";
import { listPosts } from "../store/wall-queries.js";
import { timeAgo } from "../wall-format.js";
import { readThreadTool } from "./thread-read.js";
import { agentToolResult } from "./agent-tool-result.js";
import type { AgentToolIdentity } from "./agent-tools.js";
import { activityLine, compactText, formatActivity } from "./watcher-digest.js";

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
          const recent = await readRecentActivity(agent.sessionFile);
          const text = recent.items.find((item) => item.kind === "assistant_text");
          const tool = recent.items.find((item) => item.kind === "tool_call");
          const timestamp = recent.items[0]?.timestamp ?? 0;
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
            `current tool: ${current ?? "none"}`,
            tool ? `recent ${activityLine(tool)}` : "recent tool: not in inspected slice",
            `assistant: ${text ? compactText(text.text) : "not in inspected slice"}`,
            `Recent slice: ${recent.scannedEntries} entries, ${recent.scannedBytes} bytes${recent.limited ? "; older history omitted, use swarm_agent_activity" : ""}.`,
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
    threads(params: { thread_id?: number; count?: number; offset?: number; after?: string }): string {
      const db = identity.getDb();
      requireSwarm(db, identity.swarmId);
      if (params.thread_id !== undefined) {
        return readThreadTool(
          db,
          identity.swarmId,
          identity.agentName,
          { ...params, thread_id: params.thread_id },
          clock.now(),
          "watcher",
        );
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
    description:
      "Compact states, current runtime tools, costs, acceptance and newest wall titles. One bounded recent session slice per agent, not lifetime activity. Use swarm_agent_activity for deep history. Start here.",
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
      agent: Type.String({ minLength: 1, pattern: "\\S" }),
      count: Type.Optional(Type.Integer({ minimum: 1, maximum: WATCHER_ACTIVITY_MAX })),
      before: Type.Optional(Type.String({ minLength: 1 })),
    }),
    async execute(_id, params) {
      return agentToolResult(await run.activity(params));
    },
  });
  pi.registerTool({
    name: WATCHER_TOOL.threads,
    label: "Swarm threads",
    description:
      "List all swarm threads newest first, including agent-to-agent. Supply thread_id to read bounded history, including full known User attachments by source ID. count bounds messages, after continues its Next cursor and offset is ignored. No arbitrary file paths. Read-only.",
    parameters: Type.Object({
      thread_id: Type.Optional(Type.Integer({ minimum: 1 })),
      count: Type.Optional(Type.Integer({ minimum: 1, maximum: PAGE_MAX_COUNT })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      after: Type.Optional(Type.String({ minLength: 1, description: "Next cursor from this thread_id read." })),
    }),
    async execute(_id, params) {
      return agentToolResult(run.threads(params));
    },
  });
}
