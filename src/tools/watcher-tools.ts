import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { systemClock } from "../clock.js";
import { WATCHER_ACTIVITY_DEFAULT, WATCHER_ACTIVITY_MAX, WATCHER_OVERVIEW_POSTS, WATCHER_TOOL } from "../constants.js";
import { BrokerError } from "../broker/errors.js";
import { SessionReader } from "../server/sessions.js";
import { readRecentActivity, type RecentActivity } from "../server/session-recent.js";
import { evaluateCompletion } from "../broker/completion.js";
import { getStats } from "../store/stats-queries.js";
import { getSwarm, listAgentSessions, listParticipants } from "../store/swarm-queries.js";
import { listPosts } from "../store/wall-queries.js";
import { timeAgo } from "../wall-format.js";
import { agentToolResult } from "./agent-tool-result.js";
import type { AgentToolIdentity } from "./agent-tools.js";
import { activityLine, compactText, formatActivity } from "./watcher-digest.js";

export function createWatcherToolHandlers(identity: AgentToolIdentity) {
  const reader = new SessionReader({ maxToolOutputChars: 0 });
  const clock = identity.clock ?? systemClock;
  function session(agent: string) {
    const found = identity
      .getDb()
      .read(() =>
        listAgentSessions(identity.getDb(), identity.swarmId).find(
          (item) => item.name.toLowerCase() === agent.toLowerCase(),
        ),
      );
    if (!found) throw new BrokerError("not_found", `Agent "${agent}" not found.`);
    return found;
  }
  return {
    async overview(): Promise<string> {
      const db = identity.getDb();
      const now = clock.now();
      const { swarm, stats, participants, sessions, wall, completion } = db.read(() => {
        const swarm = getSwarm(db, identity.swarmId, now);
        if (!swarm) throw new BrokerError("not_found", "Swarm not found.");
        return {
          swarm,
          stats: getStats(db, swarm.id, now),
          participants: listParticipants(db, swarm.id),
          sessions: listAgentSessions(db, swarm.id),
          wall: listPosts(db, swarm.id, { count: WATCHER_OVERVIEW_POSTS, offset: 0 }),
          completion: evaluateCompletion(db, swarm.id),
        };
      });
      const blocks = await Promise.all(
        sessions.map(async (agent) => {
          const participant = participants.find((item) => item.name === agent.name);
          const retired = participant?.kind === "agent" && participant.status === "retired";
          const recent: RecentActivity = retired
            ? { items: [], entries: [], scannedEntries: 0, scannedBytes: 0, limited: true }
            : await readRecentActivity(agent.sessionFile);
          const text = recent.items.find((item) => item.kind === "assistant_text");
          const tool = recent.items.find((item) => item.kind === "tool_call");
          const timestamp = recent.items[0]?.timestamp ?? 0;
          const usage = stats?.agents.find((item) => item.name === agent.name);
          const rawStatus = participant?.kind === "agent" ? participant.status : "stopped";
          const running = swarm.status === "running" || swarm.status === "starting";
          const status =
            rawStatus === "crashed" || rawStatus === "retired"
              ? rawStatus
              : !running
                ? "stopped"
                : rawStatus === "working"
                  ? "busy"
                  : rawStatus;
          const latest = Math.max(participant?.lastActivityAt ?? 0, timestamp);
          const current =
            running && rawStatus === "working" && participant?.kind === "agent" && participant.activity?.kind === "tool"
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
      return [
        `Swarm "${swarm.name}": ${swarm.status}; outcome ${completion.outcome ?? "unfinished"}; wall posts ${wall.total}`,
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
  };
}

export function registerWatcherTools(pi: Pick<ExtensionAPI, "registerTool">, identity: AgentToolIdentity): void {
  const run = createWatcherToolHandlers(identity);
  pi.registerTool({
    name: WATCHER_TOOL.overview,
    label: "Swarm overview",
    description:
      "Compact states, current runtime tools, costs, completion and newest post titles. One bounded recent session slice per agent, not lifetime activity. Use swarm_agent_activity for deep history. Start here.",
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
}
