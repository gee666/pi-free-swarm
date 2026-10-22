import type { ModelSelection } from "../runtime-types.js";
import type { RunEnvironment } from "./run-types.js";
export { readBudget, recordBudgetStop, BUDGET_ACCOUNTING } from "../store/budget.js";
export type { BudgetStatus } from "../budget.js";

export function assertBudgetPricing(
  env: Pick<RunEnvironment, "settings" | "launch" | "availableModels">,
  assignments: ReadonlyMap<string, ModelSelection>,
): void {
  if (env.settings.budgetMoneyUsd === undefined) return;
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
