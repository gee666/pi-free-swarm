import type { ReportedUsageCosts } from "../api-usage-types.js";
import type { UsageSample } from "../runtime-types.js";

/** SDK model defaults can report zero even when no USD prices were configured. */
export function qualifyUsagePricing(sample: UsageSample, modelPricingKnown: boolean | undefined): UsageSample {
  if (sample.kind === "tool" || sample.cost !== 0 || modelPricingKnown === true) return sample;
  return {
    ...sample,
    costKnown: false,
    ...(sample.costBreakdown ? { costBreakdown: positiveReportedCosts(sample.costBreakdown) } : {}),
  };
}

function positiveReportedCosts(costs: ReportedUsageCosts): ReportedUsageCosts {
  const known = (value: number | null) => (value !== null && Number.isFinite(value) && value > 0 ? value : null);
  return {
    input: known(costs.input),
    output: known(costs.output),
    cacheRead: known(costs.cacheRead),
    cacheWrite: known(costs.cacheWrite),
  };
}
