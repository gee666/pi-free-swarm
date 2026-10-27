import { SEARCH_CURSOR_VERSION } from "../constants.js";
import { contentHash } from "./embeddings.js";
import { isRecord } from "./settings.js";

export function queryFingerprint(value: unknown): string {
  return contentHash(JSON.stringify(value));
}

export function encodeCursor(offset: number, fingerprint: string): string {
  return Buffer.from(JSON.stringify({ version: SEARCH_CURSOR_VERSION, offset, fingerprint })).toString("base64url");
}

export function decodeCursor(cursor: string | undefined, fingerprint: string): number {
  if (cursor === undefined) return 0;
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("invalid cursor encoding");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid cursor encoding");
  }
  if (
    !isRecord(value) ||
    value.version !== SEARCH_CURSOR_VERSION ||
    typeof value.offset !== "number" ||
    !Number.isSafeInteger(value.offset) ||
    value.offset < 0
  ) {
    throw new Error("invalid cursor offset or version");
  }
  if (value.fingerprint !== fingerprint) throw new Error("cursor does not match query or candidates; restart search");
  return value.offset;
}
