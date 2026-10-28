import {
  SEARCH_MAX_RESULTS_CAP,
  SEARCH_MAX_RESULTS_DEFAULT,
  SEARCH_PAGE_DEFAULT,
  SEARCH_RERANK_WINDOW,
  SEARCH_TIMEOUT_MS,
} from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { embeddingRanking, type SearchKind } from "./embeddings.js";
import { decodeCursor, encodeCursor, queryFingerprint } from "./pagination.js";
import { bm25, reciprocalRankFusion, type SearchDocument } from "./ranking.js";
import { jevRerank, helperRerank, type SearchHelper } from "./reranking.js";
import { failureNote, withTimeout } from "./remote.js";
import { searchConfiguration } from "./configuration.js";
import { SEARCH_JEV_TIMEOUT_MS, type SearchConfiguration } from "./settings.js";

export type { SearchDocument, SearchHelper, SearchKind, SearchConfiguration };
export type SearchMode = "filter" | "bm25" | "hybrid" | "reranked";
export interface SearchResult<T> {
  items: T[];
  nextCursor: string | null;
  notes: string[];
  mode: SearchMode;
}
export interface SearchOptions<T extends SearchDocument> {
  db: SwarmDb;
  kind: SearchKind;
  query?: string;
  candidates: readonly T[];
  cursor?: string;
  limit?: number;
  settings?: SearchConfiguration;
  helper?: SearchHelper;
  fetch?: typeof fetch;
}

export async function runSearch<T extends SearchDocument>(options: SearchOptions<T>): Promise<SearchResult<T>> {
  const { candidates, helper, db, kind } = options;
  const { settings, env, notes } = searchConfiguration(db, options.settings);
  const query = options.query?.trim() ?? "";
  const config = settings.search ?? {};
  const maximum = Math.min(config.maxResults ?? SEARCH_MAX_RESULTS_DEFAULT, SEARCH_MAX_RESULTS_CAP);
  const limit = Math.min(positive(options.limit, SEARCH_PAGE_DEFAULT), maximum);
  const timeout = config.timeoutMs ?? SEARCH_TIMEOUT_MS;
  let ranked = query ? bm25(query, candidates) : [...candidates];
  let mode: SearchMode = query ? "bm25" : "filter";
  const fetcher = options.fetch ?? globalThis.fetch;
  if (query && candidates.length > 0 && kind !== "skill" && config.embedding !== undefined) {
    const endpoint = config.embedding;
    try {
      const semantic = await withTimeout(timeout, (signal) =>
        embeddingRanking({
          db,
          kind,
          query,
          documents: candidates,
          endpoint,
          signal,
          fetcher,
          env,
        }),
      );
      ranked = reciprocalRankFusion([ranked, semantic]);
      mode = "hybrid";
    } catch (error) {
      notes.push(failureNote("embeddings", error));
    }
  }
  const fingerprint = queryFingerprint({
    kind,
    query,
    candidates,
    settings,
    helper: helper !== undefined,
    baseOrder: ranked.map((item) => item.id),
  });
  const cursor = decodeCursor(options.cursor, fingerprint);
  let window = ranked.slice(0, SEARCH_RERANK_WINDOW);
  if (cursor !== null) {
    mode = cursor.mode;
    const byId = new Map(candidates.map((item) => [item.id, item]));
    window = cursor.window.flatMap((id) => {
      const item = byId.get(id);
      return item === undefined ? [] : [item];
    });
  } else if (
    query &&
    window.length > 0 &&
    kind !== "skill" &&
    (config.jev !== undefined || (settings.helperModel !== undefined && helper !== undefined))
  ) {
    try {
      const endpoint = config.jev;
      const selection = settings.helperModel;
      const rerankTimeout = endpoint === undefined ? timeout : (endpoint.timeoutMs ?? SEARCH_JEV_TIMEOUT_MS);
      window = await withTimeout(rerankTimeout, (signal) => {
        if (endpoint !== undefined) return jevRerank(query, window, endpoint, signal, fetcher, env);
        if (selection !== undefined && helper !== undefined)
          return helperRerank(query, window, selection, helper, signal);
        throw new Error("helper unavailable");
      });
      mode = "reranked";
    } catch (error) {
      notes.push(failureNote(config.jev === undefined ? "reranker" : "jev", error));
    }
  }
  const windowIds = window.map((item) => item.id);
  const excluded = new Set(windowIds);
  ranked = [...window, ...ranked.filter((item) => !excluded.has(item.id))];
  const offset = cursor?.offset ?? 0;
  const end = offset + limit;
  return {
    items: ranked.slice(offset, end),
    nextCursor: end < ranked.length ? encodeCursor(end, fingerprint, windowIds, mode) : null,
    notes,
    mode,
  };
}
function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
