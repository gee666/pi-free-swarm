import type { ConfigurationChange } from "../runtime-configuration.js";
import { badRequest } from "./api-util.js";

export interface ConfigurationEditInput {
  expectedRun: number;
  expectedRevision: number;
  change: Exclude<ConfigurationChange, { type: "retireAgent" }>;
}

export function readConfigurationEdit(body: Record<string, unknown>): ConfigurationEditInput {
  const expectedRun = body.expectedRun;
  if (typeof expectedRun !== "number" || !Number.isSafeInteger(expectedRun) || expectedRun < 1) {
    throw badRequest("expectedRun must be the positive run number from the current configuration view.", "expectedRun");
  }
  const expectedRevision = body.expectedRevision;
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw badRequest(
      "expectedRevision must be a nonnegative integer from the current configuration view.",
      "expectedRevision",
    );
  }
  const value = body.change;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("change must be an object describing one configuration edit.", "change");
  }
  const type = Reflect.get(value, "type");
  const keys = Object.keys(value);
  const allow = (fields: readonly string[]) => {
    if (keys.some((key) => !fields.includes(key))) throw badRequest("change contains unsupported fields.", "change");
  };
  if (type === "addAgents") {
    allow(["type", "count"]);
    const count: unknown = Reflect.get(value, "count");
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) {
      throw badRequest(
        "change.count must be a positive integer within this swarm's configured worker limit.",
        "change.count",
      );
    }
    return { expectedRun, expectedRevision, change: { type, count } };
  }
  if (type === "removeAgent") {
    allow(["type", "name"]);
    const name: unknown = Reflect.get(value, "name");
    if (typeof name !== "string" || !name.trim())
      throw badRequest("change.name must name an active worker.", "change.name");
    return { expectedRun, expectedRevision, change: { type, name: name.trim() } };
  }
  if (type === "raiseBudget") {
    allow(["type", "moneyUsd", "timeSeconds"]);
    const patch: { moneyUsd?: number; timeSeconds?: number } = {};
    for (const key of ["moneyUsd", "timeSeconds"] as const) {
      if (!Object.hasOwn(value, key)) continue;
      const amount: unknown = Reflect.get(value, key);
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        throw badRequest(`change.${key} must be a finite positive total ceiling.`, `change.${key}`);
      }
      patch[key] = amount;
    }
    if (Object.keys(patch).length === 0) throw badRequest("change must set moneyUsd or timeSeconds.", "change");
    return { expectedRun, expectedRevision, change: { type, ...patch } };
  }
  throw badRequest("change.type must be addAgents, removeAgent or raiseBudget.", "change.type");
}
