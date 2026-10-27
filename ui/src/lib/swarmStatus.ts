import type { ParticipantStatus, SwarmListItem, SwarmStatus } from "../../../src/api-types";
import type { AgentStatus } from "../components/Indicators";

export function isSwarmLive(status: SwarmStatus): boolean {
  return status === "starting" || status === "running";
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function swarmStatusLabel(swarm: SwarmListItem): string {
  switch (swarm.status) {
    case "starting":
      return "Running";
    case "running":
      return "Running";
    case "finished":
      return "Stopped";
    case "stopped":
      return "Stopped";
    case "interrupted":
      return "Interrupted";
  }
}

/** "10 agents" pill of the swarm picker. */
export const agentCountLabel = (swarm: SwarmListItem) => plural(swarm.agentAmount, "agent");

/** StatusDot variant of an agent: pink while working, a pink ring when crashed, grey otherwise. */
export function agentDotStatus(status: ParticipantStatus): AgentStatus {
  if (status === "working") return "live";
  return status === "crashed" ? "crashed" : "idle";
}
