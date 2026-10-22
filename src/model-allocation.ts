import type { ModelSelection } from "./runtime-types.js";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface ModelProfile {
  provider: string;
  model: string;
  thinkingLevel: string;
  count_proportional?: number;
}

/** Catalog data only. Credential values must never enter assignments or persisted configuration. */
export interface AvailableModel {
  provider: string;
  id: string;
  thinkingLevels: readonly string[];
  pricingKnown?: boolean;
}

export function parseModelProfiles(value: unknown): readonly ModelProfile[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new Error("models must be a nonempty array");
  return value.map((entry: unknown, index) => {
    const field = `models[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${field} must be an object`);
    }
    const provider = Reflect.get(entry, "provider");
    const model = Reflect.get(entry, "model");
    const thinkingLevel = Reflect.get(entry, "thinkingLevel");
    const weight = Reflect.get(entry, "count_proportional");
    if (typeof provider !== "string" || !provider.trim()) throw new Error(`${field}.provider must be nonempty`);
    if (typeof model !== "string" || !model.trim()) throw new Error(`${field}.model must be nonempty`);
    if (typeof thinkingLevel !== "string" || !THINKING_LEVELS.some((level) => level === thinkingLevel)) {
      throw new Error(`${field}.thinkingLevel must be one of ${THINKING_LEVELS.join(", ")}`);
    }
    if (weight !== undefined && (typeof weight !== "number" || !Number.isSafeInteger(weight) || weight <= 0)) {
      throw new Error(`${field}.count_proportional must be a positive safe integer; omit it for one relative part`);
    }
    return { provider, model, thinkingLevel, ...(weight === undefined ? {} : { count_proportional: weight }) };
  });
}

/** Integer arithmetic prevents rounding errors even with large valid weights. */
export function allocateModelCounts(count: number, profiles: readonly ModelProfile[]): number[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("worker count must be a positive safe integer");
  if (profiles.length === 0) throw new Error("models must be a nonempty array");
  const weights = profiles.map((profile) => {
    const value = profile.count_proportional ?? 1;
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("count_proportional must be a positive safe integer");
    return BigInt(value);
  });
  const total = weights.reduce((sum, value) => sum + value, 0n);
  const shares = weights.map((weight, index) => {
    const numerator = BigInt(count) * weight;
    return { index, count: Number(numerator / total), remainder: numerator % total };
  });
  const remaining = count - shares.reduce((sum, share) => sum + share.count, 0);
  const ranked = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const share of ranked.slice(0, remaining)) share.count++;
  return shares.map((share) => share.count);
}

export function resolveModelAssignments(
  count: number,
  profiles: readonly ModelProfile[] | undefined,
  inherited: ModelSelection | null,
  available: readonly AvailableModel[],
): ModelSelection[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("worker count must be a positive safe integer");
  if (profiles === undefined) {
    if (inherited === null) throw new Error("Select a Main model before launching workers");
    return Array.from({ length: count }, () => ({ ...inherited }));
  }
  const counts = allocateModelCounts(count, profiles);
  return profiles.flatMap((profile, index) => {
    const model = available.find(
      (candidate) => candidate.provider === profile.provider && candidate.id === profile.model,
    );
    if (model === undefined) {
      throw new Error(
        `models[${index}]: ${profile.provider}/${profile.model} is unavailable; choose an authenticated catalog model`,
      );
    }
    if (!model.thinkingLevels.includes(profile.thinkingLevel)) {
      throw new Error(
        `models[${index}].thinkingLevel: ${profile.thinkingLevel} is unsupported by ${profile.provider}/${profile.model}; choose ${model.thinkingLevels.join(", ")}`,
      );
    }
    return Array.from({ length: counts[index] ?? 0 }, () => ({
      provider: profile.provider,
      modelId: profile.model,
      thinkingLevel: profile.thinkingLevel,
    }));
  });
}
