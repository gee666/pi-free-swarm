import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { SEARCH_HELPER_PROMPT } from "../constants.js";
import { documentText } from "./embeddings.js";
import type { SearchDocument } from "./ranking.js";
import { postJson } from "./remote.js";
import { isRecord, parseHelperModel, SEARCH_JEV_MODEL, type JevSettings } from "./settings.js";

export type SearchHelper = Pick<ModelRegistry, "find" | "getApiKeyAndHeaders" | "streamSimple">;

export const SEARCH_JEV_DOCUMENT_CHARS = 600;

export async function jevRerank<T extends SearchDocument>(
  query: string,
  documents: readonly T[],
  endpoint: JevSettings,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<T[]> {
  const state = {
    query,
    documents: documents.map((document, index) => ({
      id: `d${index + 1}`,
      text: documentText(document).slice(0, SEARCH_JEV_DOCUMENT_CHARS),
    })),
  };
  const questions = Object.fromEntries(
    state.documents.map(({ id }) => [
      id,
      { type: "noul", instructions: `Is document ${id} relevant to the search query? Judge only document ${id}.` },
    ]),
  );
  const reply = await postJson(
    endpoint,
    `${endpoint.url.replace(/\/+$/, "")}/v1/systemone`,
    { model: endpoint.model ?? SEARCH_JEV_MODEL, state, questions },
    signal,
    fetcher,
  );
  if (
    !isRecord(reply) ||
    typeof reply.model !== "string" ||
    !reply.model.trim() ||
    !isRecord(reply.answers) ||
    Object.keys(reply.answers).length !== documents.length
  ) {
    throw new Error("invalid JEV reply");
  }
  const answers = reply.answers;
  return documents
    .map((document, index) => {
      const id = `d${index + 1}`;
      const answer = answers[id];
      if (
        !isRecord(answer) ||
        answer.type !== "noul" ||
        typeof answer.noul !== "number" ||
        !Number.isFinite(answer.noul) ||
        answer.noul < 0 ||
        answer.noul > 1
      ) {
        throw new Error(`invalid JEV answer ${id}`);
      }
      return { document, score: answer.noul, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.document);
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
