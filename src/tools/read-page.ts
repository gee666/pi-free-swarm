import { Buffer } from "node:buffer";
import { BrokerError } from "../broker/errors.js";

export interface ReadPosition {
  scope: string;
  snapshot: number;
  id: number;
  offset: number;
}
export interface ReadChunk {
  text: string;
  nextOffset: number | null;
}
export interface ReadItem {
  id: number;
  label: string;
  text: string;
  /** A bounded source range, when the stored body points to a known User attachment. */
  readChunk?: (offset: number, maxBytes: number) => ReadChunk | null;
}
const PAGE_BYTES = 24_000;
const TEXT_CHUNK = 3_000;

export function readPosition(after: string | undefined, scope: string, snapshot: number): ReadPosition {
  if (after === undefined) return { scope, snapshot, id: 0, offset: 0 };
  try {
    const value: unknown = JSON.parse(Buffer.from(after, "base64url").toString());
    if (
      typeof value !== "object" ||
      value === null ||
      !("scope" in value) ||
      value.scope !== scope ||
      !("snapshot" in value) ||
      !("id" in value) ||
      !("offset" in value)
    )
      throw new Error();
    const { snapshot: end, id, offset } = value;
    if (
      typeof end !== "number" ||
      typeof id !== "number" ||
      typeof offset !== "number" ||
      ![end, id, offset].every((n) => Number.isSafeInteger(n) && n >= 0)
    )
      throw new Error();
    return { scope, snapshot: end, id, offset };
  } catch {
    throw new BrokerError(
      "validation",
      "after must be a Next cursor from this read; omit after to replay history.",
      "after",
    );
  }
}

/** Full item IDs alone become coverage. A partial tail remains explicitly resumable. */
export function renderReadPage(header: string, items: ReadItem[], position: ReadPosition, count: number) {
  const lines = [header];
  const completeIds: number[] = [];
  let bytes = Buffer.byteLength(header);
  let next: ReadPosition | undefined;
  for (const [index, item] of items.entries()) {
    const offset = item.id === position.id ? position.offset : 0;
    if (index >= count) {
      next = { ...position, id: item.id, offset };
      break;
    }
    const chunk = item.readChunk?.(offset, TEXT_CHUNK);
    const text = chunk?.text ?? item.text;
    const start = chunk ? 0 : offset;
    let end = chunk ? text.length : Math.min(text.length, offset + TEXT_CHUNK);
    const last = text.charCodeAt(end - 1);
    if (!chunk && end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    const label = item.label.replaceAll("\n", "\\n");
    const line = `${label}${offset > 0 ? ` · text offset ${offset}` : ""}: ${JSON.stringify(text.slice(start, end))}`;
    if (bytes + Buffer.byteLength(line) > PAGE_BYTES) {
      next = { ...position, id: item.id, offset };
      break;
    }
    lines.push(line);
    bytes += Buffer.byteLength(line);
    const nextOffset = chunk ? chunk.nextOffset : end < text.length ? end : null;
    if (nextOffset !== null) {
      next = { ...position, id: item.id, offset: nextOffset };
      break;
    }
    completeIds.push(item.id);
  }
  lines.push(
    next === undefined
      ? `Complete: true · snapshot #${position.snapshot}. Omit after to replay or include newer content.`
      : `Complete: false · Next cursor: ${Buffer.from(JSON.stringify(next)).toString("base64url")}`,
  );
  return { text: lines.join("\n"), completeIds };
}
