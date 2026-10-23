import type { RuntimeConfigurationView } from "../runtime-configuration.js";
import { USER_NAME } from "../constants.js";
import { raiseSwarmBudget } from "../broker/budget-policy.js";
import { ConfigurationConflictError } from "../store/configuration-revisions.js";
import { getRuntimeConfiguration, queueConfigurationChange } from "../store/runtime-configuration.js";
import { readConfigurationEdit } from "./configuration-input.js";
import {
  ApiFailure,
  notFound,
  readJsonBody,
  reply,
  requireSwarmItem,
  type ApiDeps,
  type ApiRoute,
} from "./api-util.js";

export function configurationRoutes(deps: ApiDeps): ApiRoute[] {
  const view = (swarmId: number) => {
    const current = getRuntimeConfiguration(deps.db, swarmId, deps.clock.now());
    if (!current) throw notFound(`Swarm #${swarmId} not found.`);
    return current;
  };
  return [
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/config",
      handle: ({ params }) => {
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        return reply<RuntimeConfigurationView>(view(swarm.id));
      },
    },
    {
      method: "POST",
      pattern: "/api/swarms/:swarmId/config",
      handle: async ({ req, params }) => {
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const { expectedRun, expectedRevision, change } = readConfigurationEdit(await readJsonBody(req));
        try {
          if (change.type === "raiseBudget") {
            raiseSwarmBudget(
              deps.db,
              swarm.id,
              {
                ...(change.moneyUsd === undefined ? {} : { moneyUsd: change.moneyUsd }),
                ...(change.timeSeconds === undefined ? {} : { timeSeconds: change.timeSeconds }),
              },
              expectedRevision,
              deps.clock.now(),
              expectedRun,
            );
          } else {
            queueConfigurationChange(
              deps.db,
              swarm.id,
              USER_NAME,
              change,
              expectedRevision,
              deps.clock.now(),
              expectedRun,
            );
          }
        } catch (error) {
          if (error instanceof ConfigurationConflictError) {
            throw new ApiFailure(409, "validation", error.message);
          }
          throw error;
        }
        return reply<RuntimeConfigurationView>(view(swarm.id), change.type === "raiseBudget" ? 200 : 202);
      },
    },
  ];
}
