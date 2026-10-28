import type { UsageSample } from "../runtime-types.js";
import type { SwarmDb } from "../store/db.js";
import { checkUsageAccounting } from "../store/budget.js";
import { recordUsage } from "./agent-state.js";
import { qualifyUsagePricing } from "./usage-pricing.js";

export function recordAgentUsage(
  db: SwarmDb,
  swarmId: number,
  name: string,
  sample: UsageSample,
  now: number,
  run?: number,
  modelPricingKnown?: boolean,
): void {
  const captured = qualifyUsagePricing(sample, modelPricingKnown);
  const issue = db.write(() => {
    recordUsage(db, swarmId, name, captured, now, run);
    return checkUsageAccounting(db, swarmId, name, captured, now, run);
  });
  if (issue) throw issue;
}
