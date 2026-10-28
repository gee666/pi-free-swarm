import { Type, type Static } from "typebox";
import { TEXT_MAX } from "../limits.js";
import { AGENT_TOOL } from "../constants.js";
import { agentToolResult } from "./agent-tool-result.js";

export const retirementToolParameters = Type.Object(
  {
    handoff: Type.String({
      minLength: 1,
      pattern: "\\S",
      description: `Self-authored handoff under ${TEXT_MAX} characters: completed work, evidence paths, remaining work and uncertain effects.`,
    }),
  },
  { additionalProperties: false },
);

export function createRetirementTool(retire: (params: Static<typeof retirementToolParameters>) => string) {
  return {
    name: AGENT_TOOL.retire,
    label: "Retire with handoff",
    description:
      "Retire after finishing one large task or a few small ones, when you have no obligations, so a fresh agent with a clean context takes new work. Available from the start, but finish, release or hand off all claimed, in-progress or in-review tasks first. Request one fresh named replacement with your model and thinking level. Include a short self-authored handoff; this tool saves its file. Include completed work, evidence paths, remaining work and uncertain effects. The replacement receives the brief path and handoff, then discovers current tasks and criteria with swarm_project. Your previous session stays archived. Do not submit a second retirement request.",
    promptSnippet: "Retire without obligations, with a short handoff for one fresh replacement.",
    parameters: retirementToolParameters,
    async execute(_toolCallId: string, params: Static<typeof retirementToolParameters>) {
      return { ...(await agentToolResult(retire(params))), terminate: true };
    },
  };
}
