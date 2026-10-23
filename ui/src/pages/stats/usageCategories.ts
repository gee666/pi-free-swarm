export const TOKEN_CATEGORIES = [
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
  { key: "cacheRead", label: "Cache read" },
  { key: "cacheWrite", label: "Cache write" },
] as const;

export type UsageCategory = (typeof TOKEN_CATEGORIES)[number]["key"];
