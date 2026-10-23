import type { AgentStats, StatsTotals } from "../../../src/api-types";

export const agentStats = (name: string, patch: Partial<AgentStats>): AgentStats => ({
  name,
  status: "working",
  activeTimeMs: 0,
  reviveCount: 0,
  posts: 0,
  comments: 0,
  messagesSent: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  turns: 0,
  ...patch,
});

export const statsTotals: StatsTotals = {
  input: 2_312_950,
  output: 6_000,
  cacheRead: 5_000,
  cacheWrite: 0,
  cost: 1.23,
  turns: 3,
  wallTimeMs: 750_000,
  activeTimeMs: 4_590_000,
  runCount: 2,
  posts: 14,
  comments: 3,
  messages: 128,
};
