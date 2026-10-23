import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs";
import { USER_BODY_PREVIEW_CHARS, charCount } from "../limits.js";
import type { SwarmDb } from "../store/db.js";
import { text } from "../store/rows.js";
import { attachmentLocation, BODY_TABLE, type BodyKind } from "./attachment.js";
import { BrokerError } from "./errors.js";

export function hasUserAttachment(db: SwarmDb, swarmId: number, kind: BodyKind, id: number): boolean {
  return userAttachmentLocation(db, swarmId, kind, id) !== null;
}

function userAttachmentLocation(db: SwarmDb, swarmId: number, kind: BodyKind, id: number) {
  const author = kind === "message" ? "sender" : "author";
  const row = db.sql
    .prepare(
      `SELECT b.body, p.kind AS author_kind FROM ${BODY_TABLE[kind]} b JOIN participants p ON p.swarm_id = b.swarm_id AND p.name = b.${author} WHERE b.swarm_id = ? AND b.id = ?`,
    )
    .get(swarmId, id);
  if (!row || text(row, "author_kind") !== "user") return null;
  const location = attachmentLocation(db, swarmId, kind, id);
  const suffix = ` … [full text: ${location.relative}]`;
  const body = text(row, "body");
  return body.endsWith(suffix) && charCount(body.slice(0, -suffix.length)) === USER_BODY_PREVIEW_CHARS
    ? location
    : null;
}

/** Callers authorize the row first. Only an ID-derived, generated User attachment may replace its text. */
export function readUserAttachmentChunk(
  db: SwarmDb,
  swarmId: number,
  kind: BodyKind,
  id: number,
  offset: number,
  maxBytes: number,
): { text: string; nextOffset: number | null } | null {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 4) {
    throw new BrokerError(
      "validation",
      "Attachment offset must be nonnegative; chunk size must be an integer of at least 4 bytes.",
      "after",
    );
  }
  const location = userAttachmentLocation(db, swarmId, kind, id);
  if (!location) return null;
  const { absolute } = location;

  let fd: number;
  try {
    fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new BrokerError(
        "not_found",
        `Generated full text for ${kind} #${id} is missing; restore its attachment before continuing.`,
      );
    }
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new BrokerError("validation", "Generated attachment must be a regular file.");
    if (offset > stat.size)
      throw new BrokerError("validation", "Attachment cursor is beyond the file; omit after to replay.", "after");
    const buffer = Buffer.alloc(Math.min(maxBytes, stat.size - offset));
    const size = readSync(fd, buffer, 0, buffer.length, offset);
    let value: string;
    try {
      value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size), {
        stream: offset + size < stat.size,
      });
    } catch {
      throw new BrokerError(
        "validation",
        "Attachment range is not valid UTF-8; replay from the beginning or restore the generated file.",
        "after",
      );
    }
    const next = offset + Buffer.byteLength(value);
    if (next === offset && next < stat.size)
      throw new BrokerError("validation", "Attachment changed during this read; retry the same cursor.", "after");
    return { text: value, nextOffset: next < stat.size ? next : null };
  } finally {
    closeSync(fd);
  }
}
