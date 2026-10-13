import type { SendMessageResponse, ThreadResponse } from "../api-types.js";
import { replyToThread, sendMessage } from "../broker/messages.js";
import { ensureWatcher } from "../broker/watcher.js";
import { USER_NAME, WATCHER_NAME } from "../constants.js";
import { findDirectThread } from "../store/message-queries.js";
import { readJsonBody, reply, requireSwarmItem, stringField, type ApiDeps, type ApiRoute } from "./api-util.js";

export function watcherRoutes(deps: ApiDeps): ApiRoute[] {
  const { db, clock } = deps;
  return [
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/watcher",
      handle: ({ params }) => {
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        return reply<ThreadResponse | null>(findDirectThread(db, swarm.id, USER_NAME, WATCHER_NAME));
      },
    },
    {
      method: "POST",
      pattern: "/api/swarms/:swarmId/watcher",
      handle: async ({ req, params }) => {
        const text = stringField(await readJsonBody(req), "text");
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const message = db.write(() => {
          ensureWatcher(db, swarm.id);
          const thread = findDirectThread(db, swarm.id, USER_NAME, WATCHER_NAME);
          return thread
            ? replyToThread(db, swarm.id, USER_NAME, thread.thread.id, text, clock.now())
            : sendMessage(db, swarm.id, USER_NAME, [WATCHER_NAME], text, clock.now());
        });
        return reply<SendMessageResponse>({ message }, 201);
      },
    },
  ];
}
