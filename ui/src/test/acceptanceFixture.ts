import type { SwarmDetailResponse } from "../../../src/api-types";

export const acceptance: SwarmDetailResponse["acceptance"] = {
  swarmId: 3,
  originalTask: "Implement OAuth login",
  acceptanceCriteria: ["OAuth login works."],
  revision: 0,
  verdict: "unchecked",
  updatedBy: null,
  updatedAt: null,
  votes: [],
  counts: { accepted: 0, incomplete: 0, blocked: 0 },
  threshold: 3,
  totalAgents: 3,
};
