export type AgentAction = "work" | "stats" | "compose";

export function agentDestination(swarmId: string, name: string, action: AgentAction): string {
  const base = `/s/${encodeURIComponent(swarmId)}`;
  if (action === "work") return `${base}/work/${encodeURIComponent(name)}`;
  const query = new URLSearchParams();
  query.set(action === "stats" ? "agent" : "compose", name);
  return `${base}/${action === "stats" ? "stats" : "agents/User"}?${query}`;
}
