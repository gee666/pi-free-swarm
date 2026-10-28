// The board's REST API (contracts in api-types.ts). Requests outside its routes fall through to the next handler.
import { workReadRoutes } from "./api-work-read.js";
import { workWriteRoutes } from "./api-work-write.js";
import { skillRoutes } from "./api-skills.js";
import { configurationRoutes } from "./api-config.js";
import { readRoutes } from "./api-read.js";
import { createFileRoutes } from "./api-files.js";
import { matchRoute, sendError, type ApiDeps } from "./api-util.js";
import { writeRoutes } from "./api-write.js";
import { sendJson, type RouteHandler } from "./http.js";

export function createApiRoutes(deps: ApiDeps): RouteHandler {
  const files = createFileRoutes(deps);
  const routes = [
    ...workReadRoutes(deps),
    ...workWriteRoutes(deps),
    ...skillRoutes(deps),
    ...readRoutes(deps),
    ...writeRoutes(deps),
    ...configurationRoutes(deps),
  ];
  return async (req, res, url) => {
    if (await files(req, res, url)) return true;
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = matchRoute(route.pattern, url.pathname);
      if (params === null) continue;
      try {
        const { status, body } = await route.handle({ req, url, params });
        sendJson(res, status, body);
      } catch (error) {
        sendError(res, error, deps.onError);
      }
      return true;
    }
    return false;
  };
}
