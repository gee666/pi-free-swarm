import { SEARCH_CURSOR_VERSION, SEARCH_RERANK_WINDOW } from "../constants.js";
import { BrokerError } from "../broker/errors.js";
import { contentHash } from "./embeddings.js";
import type { SearchMode } from "./index.js";
import { isRecord } from "./settings.js";

export interface SearchCursor {
  offset: number;
  window: string[];
  mode: SearchMode;
}
export function queryFingerprint(value: unknown): string {
  return contentHash(JSON.stringify(value));
}
export function encodeCursor(offset: number, fingerprint: string, window: readonly string[], mode: SearchMode): string {
  return Buffer.from(JSON.stringify({ version: SEARCH_CURSOR_VERSION, offset, fingerprint, window, mode })).toString(
    "base64url",
  );
}
export function decodeCursor(cursor: string | undefined, fingerprint: string): SearchCursor | null {
  if (cursor === undefined) return null;
  let value: unknown;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("encoding");
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (
    !isRecord(value) ||
    value.version !== SEARCH_CURSOR_VERSION ||
    typeof value.offset !== "number" ||
    !Number.isSafeInteger(value.offset) ||
    value.offset < 0 ||
    !Array.isArray(value.window) ||
    value.window.length > SEARCH_RERANK_WINDOW ||
    !value.window.every((id: unknown): id is string => typeof id === "string") ||
    new Set(value.window).size !== value.window.length ||
    (value.mode !== "filter" && value.mode !== "bm25" && value.mode !== "hybrid" && value.mode !== "reranked")
  )
    throw invalidCursor();
  if (value.fingerprint !== fingerprint)
    throw new BrokerError(
      "validation",
      "Search cursor no longer matches the query, settings or candidates. Restart the search without a cursor.",
      "cursor",
    );
  return { offset: value.offset, window: value.window, mode: value.mode };
}
function invalidCursor(): BrokerError {
  return new BrokerError("validation", "Invalid search cursor. Restart the search without a cursor.", "cursor");
}
