import type { ModelSelection } from "../runtime-types.js";
import type { RunEnvironment } from "./run-types.js";
import { hasBudgetAccountingGap } from "../store/budget.js";
import { hasUnverifiedUsageCost } from "../store/usage-provenance.js";
export { readBudget, recordBudgetStop, BUDGET_ACCOUNTING } from "../store/budget.js";
export type { BudgetStatus } from "../budget.js";

export function assertBudgetPricing(
  env: Pick<RunEnvironment, "settings" | "launch" | "availableModels"> & { db?: RunEnvironment["db"] },
  assignments: ReadonlyMap<string, ModelSelection>,
  swarmId?: number,
): void {
  if (env.settings.budgetMoneyUsd === undefined) return;
  if (
    env.db &&
    swarmId !== undefined &&
    (hasBudgetAccountingGap(env.db, swarmId) || hasUnverifiedUsageCost(env.db, swarmId))
  ) {
    throw new Error(
      "Money budget accounting is incomplete for this swarm. Missing costs cannot be repaired by raising the ceiling; inspect usage and resume without a money limit only with user agreement.",
    );
  }
  const models = [...assignments.values(), env.launch.model];
  for (const model of models) {
    if (!model) throw new Error("budgetMoneyUsd requires a resolved Main/Watcher model with known USD pricing");
    const available = env.availableModels?.find(
      (entry) => entry.provider === model.provider && entry.id === model.modelId,
    );
    if (!available?.pricingKnown) {
      throw new Error(
        `budgetMoneyUsd requires known USD pricing for ${model.provider}/${model.modelId}; configure pricing or omit the money budget`,
      );
    }
  }
}
