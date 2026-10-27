import type { SearchConfigResponse, SkillResponse, SkillsResponse } from "../api-types.js";
import { SEARCH_MAX_RESULTS_DEFAULT } from "../constants.js";
import { SEARCH_JEV_MODEL } from "../search/settings.js";
import { getSkill, searchSkills } from "../skills/index.js";
import { syncSkillsAndNotify } from "../broker/skill-sync.js";
import { notFound, reply, requireSwarmItem, type ApiDeps, type ApiRoute } from "./api-util.js";
import { searchQuery, searchSettings } from "./work-input.js";

export function skillRoutes(deps: ApiDeps): ApiRoute[] {
  return [
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/skills",
      handle: async ({ params, url }) => {
        deps.db.read(() => requireSwarmItem(deps, params.id("swarmId")));
        syncSkillsAndNotify(deps.db, deps.clock.now());
        const result = await searchSkills({ db: deps.db, ...searchQuery(url) });
        return reply<SkillsResponse>(result);
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/skills/:name",
      handle: ({ params }) => {
        deps.db.read(() => requireSwarmItem(deps, params.id("swarmId")));
        syncSkillsAndNotify(deps.db, deps.clock.now());
        return deps.db.read(() => {
          const { skill } = getSkill(deps.db, params.text("name"));
          if (skill === null) throw notFound(`Skill ${params.text("name")} not found.`);
          return reply<SkillResponse>(skill);
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/search-config",
      handle: ({ params }) => {
        return deps.db.read(() => {
          requireSwarmItem(deps, params.id("swarmId"));
          const settings = searchSettings(deps.db);
          return reply<SearchConfigResponse>({
            ranking: "bm25",
            embedding: settings.search?.embedding?.model ?? "off",
            reranker:
              settings.search?.jev !== undefined
                ? `JEV ${settings.search.jev.model ?? SEARCH_JEV_MODEL}`
                : settings.helperModel
                  ? `helper model ${settings.helperModel}`
                  : "off",
            maxResults: settings.search?.maxResults ?? SEARCH_MAX_RESULTS_DEFAULT,
          });
        });
      },
    },
  ];
}
