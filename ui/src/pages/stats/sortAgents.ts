import type { AgentStats } from "../../../../src/api-types";

export type SortKey = "name" | "status" | "activeTimeMs" | "input" | "output" | "cacheRead" | "cost";

export interface Sort {
  key: SortKey;
  descending: boolean;
}

export const DEFAULT_SORT: Sort = { key: "cost", descending: true };

const TEXT_KEYS: ReadonlySet<SortKey> = new Set(["name", "status"]);

export const isTextKey = (key: SortKey) => TEXT_KEYS.has(key);

function compare(left: string | number, right: string | number): number {
  return typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right));
}

/** Stable, so ties keep the server's launch order. */
export function sortAgents(agents: readonly AgentStats[], sort: Sort): AgentStats[] {
  const sign = sort.descending ? -1 : 1;
  return [...agents].sort((left, right) => sign * compare(left[sort.key], right[sort.key]));
}

/** Clicking the active column flips it; a new column starts A→Z for text and largest first for numbers. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, descending: !current.descending };
  return { key, descending: !isTextKey(key) };
}
