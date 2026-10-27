import type { SendMessageResponse, WatcherResponse } from "../api-types.js";
import { sendMessage } from "../broker/messages.js";
import { ensureWatcher } from "../broker/watcher.js";
import { USER_NAME, WATCHER_NAME } from "../constants.js";
import { findDirectThread } from "../store/message-queries.js";
import { listAgentSessions } from "../store/swarm-queries.js";
import { readRecentActivity } from "./session-recent.js";
import { pendingWatcherQuestion, watcherFallback } from "./watcher-fallback.js";
import { readUserJsonBody, reply, requireSwarmItem, stringField, type ApiDeps, type ApiRoute } from "./api-util.js";

export function watcherRoutes(deps: ApiDeps): ApiRoute[] {
  const { db, clock } = deps;
  return [
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/watcher",
      handle: async ({ params }) => {
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const thread = findDirectThread(db, swarm.id, USER_NAME, WATCHER_NAME);
        if (!thread) return reply<WatcherResponse | null>(null);
        if (!pendingWatcherQuestion(thread)) return reply<WatcherResponse>(thread);
        const watcher = listAgentSessions(db, swarm.id).find((agent) => agent.name === WATCHER_NAME);
        const recent = watcher ? await readRecentActivity(watcher.sessionFile) : null;
        const fallback = recent ? watcherFallback(thread, recent.entries) : undefined;
        return reply<WatcherResponse>({ ...thread, ...(fallback ? { fallback } : {}) });
      },
    },
    {
      method: "POST",
      pattern: "/api/swarms/:swarmId/watcher",
      handle: async ({ req, params }) => {
        const text = stringField(await readUserJsonBody(req), "text");
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const message = db.write(() => {
          ensureWatcher(db, swarm.id);
          return sendMessage(db, { swarmId: swarm.id, from: USER_NAME, to: WATCHER_NAME, text, now: clock.now() });
        });
        return reply<SendMessageResponse>({ message }, 201);
      },
    },
  ];
}
