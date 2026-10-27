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
import { dedicatedRerank, helperRerank, type SearchHelper } from "./reranking.js";
import { failureNote, withTimeout } from "./remote.js";
import type { SearchConfiguration } from "./settings.js";

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
  const { candidates, settings = {}, helper, db, kind } = options;
  const query = options.query?.trim() ?? "";
  const notes: string[] = [];
  let ranked = [...candidates];
  let mode: SearchMode = query ? "bm25" : "filter";
  const config = settings.search ?? {};
  const maximum = Math.min(positive(config.maxResults, SEARCH_MAX_RESULTS_DEFAULT), SEARCH_MAX_RESULTS_CAP);
  const limit = Math.min(positive(options.limit, SEARCH_PAGE_DEFAULT), maximum);
  try {
    const timeout = positive(config.timeoutMs, SEARCH_TIMEOUT_MS);
    const fingerprint = queryFingerprint({ kind, query, candidates, settings, helper: helper !== undefined });
    let offset: number;
    try {
      offset = decodeCursor(options.cursor, fingerprint);
    } catch (error) {
      return { items: [], nextCursor: null, mode, notes: [failureNote("cursor", error)] };
    }
    if (query && candidates.length > 0) {
      ranked = bm25(query, candidates);
      const fetcher = options.fetch ?? globalThis.fetch;
      if (config.embedding !== undefined) {
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
            }),
          );
          ranked = reciprocalRankFusion([ranked, semantic]);
          mode = "hybrid";
        } catch (error) {
          notes.push(failureNote("embeddings", error));
        }
      }
      const window = ranked.slice(0, SEARCH_RERANK_WINDOW);
      if (config.reranker !== undefined || (settings.helperModel !== undefined && helper !== undefined)) {
        try {
          const endpoint = config.reranker;
          const selection = settings.helperModel;
          const reranked = await withTimeout(timeout, (signal) => {
            if (endpoint !== undefined) return dedicatedRerank(query, window, endpoint, signal, fetcher);
            if (selection !== undefined && helper !== undefined)
              return helperRerank(query, window, selection, helper, signal);
            throw new Error("helper unavailable");
          });
          ranked = [...reranked, ...ranked.slice(window.length)];
          mode = "reranked";
        } catch (error) {
          notes.push(failureNote("reranker", error));
        }
      }
    }
    const end = offset + limit;
    return {
      items: ranked.slice(offset, end),
      nextCursor: end < ranked.length ? encodeCursor(end, fingerprint) : null,
      notes,
      mode,
    };
  } catch (error) {
    return {
      items: ranked.slice(0, limit),
      nextCursor: null,
      notes: [...notes, failureNote("search", error)],
      mode,
    };
  }
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
