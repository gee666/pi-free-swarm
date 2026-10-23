import type { AcceptanceHistoryPage } from "../store/acceptance-types.js";
import { readAcceptanceHistory } from "../broker/acceptance-history.js";
import { PAGE_DEFAULT_COUNT } from "../constants.js";
import { badRequest, intQuery, reply, requireSwarmItem, type ApiDeps, type ApiRoute } from "./api-util.js";

export function acceptanceHistoryRoutes(deps: ApiDeps): ApiRoute[] {
  return [
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/acceptance/history",
      handle: ({ params, url }) => {
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        if (url.searchParams.has("offset"))
          throw badRequest("Use the returned after cursor to continue acceptance history, not offset.", "offset");
        const page = readAcceptanceHistory(deps.db, swarm.id, {
          count: intQuery(url, "count", PAGE_DEFAULT_COUNT),
          after: url.searchParams.get("after") ?? undefined,
        });
        return reply<AcceptanceHistoryPage>(page);
      },
    },
  ];
}
