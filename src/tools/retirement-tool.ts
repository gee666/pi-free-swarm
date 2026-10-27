import { Type, type Static } from "typebox";
import { AGENT_TOOL } from "../constants.js";
import { agentToolResult } from "./agent-tool-result.js";

export const retirementToolParameters = Type.Object(
  {
    handoff: Type.String({
      minLength: 1,
      pattern: "\\S",
      description:
        "Self-authored handoff under 200 characters: completed work, evidence paths, remaining work and uncertain effects.",
    }),
  },
  { additionalProperties: false },
);

export function createRetirementTool(retire: (params: Static<typeof retirementToolParameters>) => string) {
  return {
    name: AGENT_TOOL.retire,
    label: "Retire with handoff",
    description:
      "Available only after your first idle turn. Request one fresh named replacement with your model and thinking level. Supply a concise self-authored handoff; this tool saves its file. Include completed work, evidence paths, remaining work and uncertain effects. The replacement receives the brief path and handoff, then discovers current tasks and criteria with swarm_project. Your private traffic stays with your session. Do not submit a second retirement request.",
    promptSnippet: "Retire after first idle with a handoff for one fresh replacement.",
    parameters: retirementToolParameters,
    async execute(_toolCallId: string, params: Static<typeof retirementToolParameters>) {
      return { ...(await agentToolResult(retire(params))), terminate: true };
    },
  };
}
