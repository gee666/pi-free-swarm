import type { AgentParticipantView } from "../../../../src/api-types";

/** Second line of a Work list row: "running bash…", "thinking…", or the status when nothing is going on. */
export function activityLabel(agent: AgentParticipantView): string {
  const { activity } = agent;
  if (activity?.kind === "tool") return `running ${activity.toolName}…`;
  if (activity?.kind === "thinking") return "thinking…";
  if (activity?.kind === "writing") return "writing…";
  return agent.status === "working" || agent.status === "starting" ? `${agent.status}…` : agent.status;
}
