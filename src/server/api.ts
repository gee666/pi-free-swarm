// The board's REST API (contracts in api-types.ts). Requests outside its routes fall through to the next handler.
import { readRoutes } from "./api-read.js";
import { matchRoute, sendError, type ApiDeps } from "./api-util.js";
import { writeRoutes } from "./api-write.js";
import { sendJson, type RouteHandler } from "./http.js";

export function createApiRoutes(deps: ApiDeps): RouteHandler {
  const routes = [...readRoutes(deps), ...writeRoutes(deps)];
  return async (req, res, url) => {
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = matchRoute(route.pattern, url.pathname);
      if (params === null) continue;
      try {
        const { status, body } = await route.handle({ req, url, params });
        sendJson(res, status, body);
      } catch (error) {
        sendError(res, error);
      }
      return true;
    }
    return false;
  };
}
