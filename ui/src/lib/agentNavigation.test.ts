import { describe, expect, it } from "vitest";
import { agentDestination, type AgentAction } from "./agentNavigation";

describe("agentDestination", () => {
  const name = "Zoë / A&B?#";
  it("encodes the work selection as a path segment", () => {
    expect(agentDestination("3", name, "work")).toBe(`/s/3/work/${encodeURIComponent(name)}`);
  });
  it.each(["stats"] satisfies AgentAction[])("round-trips %s names through query parameters", (action) => {
    const url = new URL(agentDestination("3", name, action), "http://localhost");
    expect(url.pathname).toBe(action === "stats" ? "/s/3/stats" : "/s/3/agents/User");
    expect(url.searchParams.get("agent")).toBe(name);
  });
});
