import { createAssistantMessageEventStream, type Api, type Model } from "@earendil-works/pi-ai";
import type { SearchHelper } from "../../src/search/index.js";
import { isRecord } from "../../src/search/settings.js";

export const documents = [
  { id: "a", title: "Merge worktrees", text: "merge" },
  { id: "b", title: "Testing", text: "tests" },
];

export function helper(reply: string, called: () => void = () => {}): SearchHelper {
  const model: Model<Api> = {
    id: "folder/model",
    name: "test",
    provider: "fake",
    api: "openai-completions",
    baseUrl: "http://unused",
    input: ["text"],
    reasoning: true,
    contextWindow: 1000,
    maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  return {
    find(provider, id) {
      return provider === "fake" && id === model.id ? model : undefined;
    },
    async getApiKeyAndHeaders() {
      return { ok: true, apiKey: "secret" };
    },
    streamSimple(found, context, options) {
      called();
      if (found !== model || options?.reasoning !== "low" || options.apiKey !== "secret" || !context.systemPrompt) {
        throw new Error("incorrect helper configuration");
      }
      const stream = createAssistantMessageEventStream();
      stream.end({
        role: "assistant",
        content: [{ type: "text", text: reply }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        stopReason: "stop",
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      });
      return stream;
    },
  };
}

export function body(init: RequestInit | undefined): Record<string, unknown> {
  const value: unknown = JSON.parse(String(init?.body));
  if (!isRecord(value)) throw new Error("invalid request body");
  return value;
}
