import { WatcherChatConflict } from "../broker/watcher-chat.js";
import {
  ApiFailure,
  badRequest,
  readUserJsonBody,
  reply,
  requireSwarmItem,
  stringField,
  type ApiDeps,
  type ApiRoute,
} from "./api-util.js";

export function watcherRoutes(deps: ApiDeps): ApiRoute[] {
  const pattern = "/api/swarms/:swarmId/watcher";
  const service = deps.watcherChat;
  async function mutate(action: () => Promise<unknown>, status: number) {
    try {
      return reply(await action(), status);
    } catch (error) {
      if (error instanceof WatcherChatConflict) throw new ApiFailure(409, "validation", error.message);
      throw error;
    }
  }
  return [
    {
      method: "GET",
      pattern,
      handle: ({ params }) => {
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        return reply(service.snapshot(swarm.id));
      },
    },
    {
      method: "POST",
      pattern,
      handle: async ({ req, params }) => {
        const body = await readUserJsonBody(req);
        const text = stringField(body, "text");
        const sessionId = body.sessionId;
        if (sessionId !== undefined && sessionId !== null && typeof sessionId !== "string")
          throw badRequest("sessionId must be a string or null.", "sessionId");
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        return mutate(() => service.send(swarm.id, text, sessionId), 202);
      },
    },
    {
      method: "POST",
      pattern: pattern + "/new",
      handle: async ({ req, params }) => {
        await readUserJsonBody(req);
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        return mutate(() => service.newChat(swarm.id), 201);
      },
    },
  ];
}
