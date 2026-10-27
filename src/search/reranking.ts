import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { SEARCH_HELPER_PROMPT } from "../constants.js";
import { documentText } from "./embeddings.js";
import type { SearchDocument } from "./ranking.js";
import { postJson } from "./remote.js";
import { isRecord, parseHelperModel, type SearchEndpoint } from "./settings.js";

export type SearchHelper = Pick<ModelRegistry, "find" | "getApiKeyAndHeaders" | "streamSimple">;

export async function dedicatedRerank<T extends SearchDocument>(
  query: string,
  documents: readonly T[],
  endpoint: SearchEndpoint,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<T[]> {
  const reply = await postJson(
    endpoint,
    endpoint.url,
    {
      model: endpoint.model,
      query,
      documents: documents.map(documentText),
      top_n: documents.length,
    },
    signal,
    fetcher,
  );
  if (!isRecord(reply) || !Array.isArray(reply.results) || reply.results.length !== documents.length) {
    throw new Error("invalid reranker reply");
  }
  const seen = new Set<number>();
  const ranked: { document: T; score: number; index: number }[] = [];
  for (const result of reply.results) {
    if (
      !isRecord(result) ||
      typeof result.index !== "number" ||
      !Number.isInteger(result.index) ||
      seen.has(result.index) ||
      typeof result.relevance_score !== "number" ||
      !Number.isFinite(result.relevance_score)
    ) {
      throw new Error("invalid reranker result");
    }
    const document = documents[result.index];
    if (document === undefined) throw new Error("invalid reranker index");
    seen.add(result.index);
    ranked.push({ document, score: result.relevance_score, index: result.index });
  }
  return ranked.sort((a, b) => b.score - a.score || a.index - b.index).map((entry) => entry.document);
}

export async function helperRerank<T extends SearchDocument>(
  query: string,
  documents: readonly T[],
  selection: string,
  helper: SearchHelper,
  signal: AbortSignal,
): Promise<T[]> {
  const { provider, model: modelId, reasoning } = parseHelperModel(selection);
  const model = helper.find(provider, modelId);
  if (model === undefined) throw new Error(`helper model not found: ${provider}/${modelId}`);
  const auth = await helper.getApiKeyAndHeaders(model);
  signal.throwIfAborted();
  if (!auth.ok) throw new Error(auth.error);
  const message = await helper
    .streamSimple(
      auth.baseUrl === undefined ? model : { ...model, baseUrl: auth.baseUrl },
      {
        systemPrompt: SEARCH_HELPER_PROMPT,
        messages: [{ role: "user", content: JSON.stringify({ query, documents }), timestamp: Date.now() }],
      },
      { apiKey: auth.apiKey, headers: auth.headers, env: auth.env, reasoning, signal, maxRetries: 0 },
    )
    .result();
  signal.throwIfAborted();
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(message.errorMessage ?? message.stopReason);
  }
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  let ids: unknown;
  try {
    ids = JSON.parse(text);
  } catch {
    throw new Error("invalid helper JSON reply");
  }
  if (!Array.isArray(ids) || ids.length !== documents.length) throw new Error("invalid helper id list");
  const byId = new Map(documents.map((document) => [document.id, document]));
  const ranked: T[] = [];
  for (const id of ids) {
    const document = typeof id === "string" ? byId.get(id) : undefined;
    if (document === undefined) throw new Error("invalid or duplicate helper id");
    ranked.push(document);
    byId.delete(document.id);
  }
  return ranked;
}
