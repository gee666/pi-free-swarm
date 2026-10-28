import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { AGENT_TOOL, REVIEW_CONTEXT_MAX } from "../constants.js";
import { BrokerError } from "../broker/errors.js";
import { reviewTask } from "../broker/review.js";
import { agentToolResult } from "./agent-tool-result.js";
import { workInput, type AgentToolIdentity } from "./agent-tool-context.js";

const parameters = Type.Object(
  {
    task_id: Type.Integer({ minimum: 1 }),
    context: Type.String({
      minLength: 1,
      maxLength: REVIEW_CONTEXT_MAX,
      pattern: "\\S",
      description: "What changed, where, and how to verify it.",
    }),
    resume: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export function createReviewTool(identity: AgentToolIdentity) {
  return {
    name: AGENT_TOOL.review,
    label: "Review task",
    description:
      "Review your in_progress task with a clean subagent using your model and thinking level. Supply what changed, where and how to verify, up to 4000 characters. Blocks until accepted or changes requested. Fix findings, then use resume: true to continue the same task's review session. No peer reviewer or User approval is needed.",
    promptSnippet: "swarm_review checks your task with an isolated review subagent; resume after fixing findings.",
    parameters,
    async execute(
      _id: string,
      params: unknown,
      signal: AbortSignal | undefined,
      _update: unknown,
      ctx: ExtensionToolContext,
    ) {
      if (!Value.Check(parameters, params)) throw new BrokerError("validation", "Invalid swarm_review arguments.");
      if (!ctx.model) throw new BrokerError("validation", "swarm_review requires the caller's selected model.");
      const prices = [ctx.model.cost.input, ctx.model.cost.output, ctx.model.cost.cacheRead, ctx.model.cost.cacheWrite];
      const result = await reviewTask(
        identity.getDb(),
        { ...workInput(identity), id: params.task_id, context: params.context, resume: params.resume },
        {
          model: { provider: ctx.model.provider, modelId: ctx.model.id, thinkingLevel: ctx.thinkingLevel ?? null },
          modelPricingKnown:
            prices.every((price) => Number.isFinite(price) && price >= 0) && prices.some((price) => price > 0),
          signal,
          clock: identity.clock,
        },
      );
      return agentToolResult(result);
    },
  };
}
