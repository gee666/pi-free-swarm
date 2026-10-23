import type { RunConfiguration, SavedRunConfiguration } from "../run-configuration.js";
import type { ConfigurationChange } from "../runtime-configuration.js";
import type { SwarmDb } from "../store/db.js";
import { USER_NAME } from "../constants.js";
import { hasBudgetAccountingGap } from "../store/budget.js";
import { appendConfigurationRevision, ConfigurationConflictError } from "../store/configuration-revisions.js";
import { getRunConfiguration } from "../store/run-configuration.js";
import { queueConfigurationChange, finishConfigurationRequest } from "../store/runtime-configuration.js";
import { BrokerError } from "./errors.js";

type BudgetPolicy = RunConfiguration["budget"];

/** Safe while stopped too: the revision is durable before any later resume admission. */
export function raiseSwarmBudget(
  db: SwarmDb,
  swarmId: number,
  input: unknown,
  expectedRevision: number,
  now: number,
  expectedRun?: number,
): SavedRunConfiguration {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new BrokerError(
      "validation",
      "expectedRevision must be a nonnegative safe integer from the current configuration view.",
      "expectedRevision",
    );
  }
  if (expectedRun !== undefined && (!Number.isSafeInteger(expectedRun) || expectedRun < 1)) {
    throw new BrokerError(
      "validation",
      "expectedRun must be a positive safe integer from the current configuration view.",
      "expectedRun",
    );
  }
  return db.write(() => {
    const saved = getRunConfiguration(db, swarmId);
    if (!saved)
      throw new BrokerError(
        "validation",
        "This swarm has no recorded budget policy. Resume it to capture a configuration before editing budgets.",
        "budget",
      );
    if (expectedRun !== undefined && saved.run !== expectedRun) {
      throw new ConfigurationConflictError("The swarm run changed. Refresh configuration before editing budgets.");
    }
    if ((saved.revision ?? 0) !== expectedRevision) {
      throw new ConfigurationConflictError(
        `Configuration revision changed to ${saved.revision ?? 0}. Refresh before editing.`,
      );
    }
    const budget = validateSwarmBudgetRaise(db, swarmId, saved.effective.budget, input);
    const change: ConfigurationChange = {
      type: "raiseBudget",
      ...(budget.moneyUsd !== null && budget.moneyUsd !== saved.effective.budget.moneyUsd
        ? { moneyUsd: budget.moneyUsd }
        : {}),
      ...(budget.timeSeconds !== null && budget.timeSeconds !== saved.effective.budget.timeSeconds
        ? { timeSeconds: budget.timeSeconds }
        : {}),
    };
    const request = queueConfigurationChange(db, swarmId, USER_NAME, change, expectedRevision, now, expectedRun);
    const result = appendConfigurationRevision(
      db,
      swarmId,
      saved.run,
      { ...saved.effective, budget },
      expectedRevision,
      now,
    );
    finishConfigurationRequest(db, request.id, "applied", null, now);
    return result;
  });
}

const CEILINGS = ["moneyUsd", "timeSeconds"] as const;

export function validateSwarmBudgetRaise(
  db: SwarmDb,
  swarmId: number,
  current: BudgetPolicy,
  input: unknown,
): BudgetPolicy {
  const budget = raiseBudgetPolicy(current, input);
  if (budget.moneyUsd !== null && hasBudgetAccountingGap(db, swarmId)) {
    throw new BrokerError(
      "validation",
      "Money accounting is incomplete. Raising a ceiling cannot repair unknown costs; inspect the evidence before resuming without a money limit.",
      "budget.moneyUsd",
    );
  }
  return budget;
}

/** Runtime edits raise total ceilings; they never reset accounting or change shutdown policy. */
export function raiseBudgetPolicy(current: BudgetPolicy, input: unknown): BudgetPolicy {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new BrokerError("validation", "budget must be an object containing moneyUsd or timeSeconds.", "budget");
  }
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.some((key) => key !== "moneyUsd" && key !== "timeSeconds")) {
    throw new BrokerError(
      "validation",
      "budget accepts only increased moneyUsd and timeSeconds total ceilings.",
      "budget",
    );
  }
  const next = { ...current };
  for (const key of CEILINGS) {
    if (!Object.hasOwn(input, key)) continue;
    const value: unknown = Reflect.get(input, key);
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new BrokerError("validation", `budget.${key} must be a finite positive total ceiling.`, `budget.${key}`);
    }
    const previous = current[key];
    if (previous === null) {
      throw new BrokerError(
        "validation",
        `budget.${key} is already unlimited; there is no ceiling to raise.`,
        `budget.${key}`,
      );
    }
    if (value <= previous) {
      throw new BrokerError(
        "validation",
        `budget.${key} must exceed its current total ceiling (${previous}); cumulative consumption is not reset.`,
        `budget.${key}`,
      );
    }
    next[key] = value;
  }
  return next;
}
