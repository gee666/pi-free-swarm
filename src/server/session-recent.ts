import { open } from "node:fs/promises";
import type { SessionItem } from "../api-types.js";
import { WATCHER_ACTIVITY_MAX, WATCHER_OVERVIEW_BYTES } from "../constants.js";
import { collectEffects, entryItems, parseEntry } from "./session-parse.js";

export interface RecentActivity {
  items: SessionItem[];
  scannedBytes: number;
  scannedEntries: number;
  limited: boolean;
}

/** A bounded tail snapshot. Unlike deep paging, this never searches outside its byte/entry window. */
export async function readRecentActivity(sessionFile: string): Promise<RecentActivity> {
  const empty = { items: [], scannedBytes: 0, scannedEntries: 0, limited: false };
  let file;
  try {
    file = await open(sessionFile, "r");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))
      return empty;
    throw error;
  }
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - WATCHER_OVERVIEW_BYTES);
    const bytes = Buffer.alloc(Math.min(size, WATCHER_OVERVIEW_BYTES));
    let filled = 0;
    while (filled < bytes.length) {
      const { bytesRead } = await file.read(bytes, filled, bytes.length - filled, start + filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    const tail = bytes.subarray(0, filled);
    // Drop partial boundary records before decoding, so split UTF-8 cannot corrupt a parsed entry.
    const first = start === 0 ? 0 : tail.indexOf(0x0a) + 1;
    const last = tail.lastIndexOf(0x0a);
    if (last < first || (start > 0 && first === 0)) return { ...empty, scannedBytes: filled, limited: size > 0 };
    const lines = tail.toString("utf8", first, last).split("\n");
    const entries = lines.slice(-WATCHER_ACTIVITY_MAX).map(parseEntry);
    const effects = collectEffects(entries);
    return {
      items: entries.flatMap((entry) => entryItems(entry, effects, 0)).reverse(),
      scannedBytes: filled,
      scannedEntries: entries.length,
      limited: start > 0 || lines.length > entries.length,
    };
  } finally {
    await file.close();
  }
}
