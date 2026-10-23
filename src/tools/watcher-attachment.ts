import { WATCHER_NAME } from "../constants.js";
import type { BodyKind } from "../broker/attachment.js";
import { hasUserAttachment, readUserAttachmentChunk } from "../broker/user-attachment.js";
import type { SwarmDb } from "../store/db.js";
import type { ReadItem } from "./read-page.js";

/** A stored preview cannot cover the original source Watcher must retrieve through these tools. */
export function isWatcherAttachment(db: SwarmDb, swarmId: number, reader: string, kind: BodyKind, id: number): boolean {
  return reader === WATCHER_NAME && hasUserAttachment(db, swarmId, kind, id);
}

/** Watcher has no filesystem tool; authorize the parent read before attaching this ID-only source. */
export function withWatcherAttachment(
  db: SwarmDb,
  swarmId: number,
  reader: string,
  kind: BodyKind,
  sourceId: number,
  item: ReadItem,
): ReadItem {
  if (reader !== WATCHER_NAME) return item;
  return {
    ...item,
    readChunk: (offset, maxBytes) => readUserAttachmentChunk(db, swarmId, kind, sourceId, offset, maxBytes),
  };
}
