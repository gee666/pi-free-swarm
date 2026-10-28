export type AgentAction = "work" | "stats";

export function agentDestination(swarmId: string, name: string, action: AgentAction): string {
  const base = `/s/${encodeURIComponent(swarmId)}`;
  if (action === "work") return `${base}/work/${encodeURIComponent(name)}`;
  const query = new URLSearchParams();
  query.set("agent", name);
  return `${base}/stats?${query}`;
}
