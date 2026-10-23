// Over-long communication bodies: rejecting one costs the author a retry turn, so the full text goes
// to a file and the stored body is its head plus the file's path.
import fs from "node:fs";
import path from "node:path";
import { ATTACHMENTS_DIR } from "../constants.js";
import { bodyCeiling, charCount, clipWithSuffix, USER_BODY_PREVIEW_CHARS } from "../limits.js";
import type { ParticipantKind } from "../api-types.js";
import type { SwarmDb } from "../store/db.js";
import { int } from "../store/rows.js";
import { bodyLimit, projectOf } from "./body-limit.js";
import { requireText } from "./validate.js";

export type BodyKind = "post" | "comment" | "message";

export const BODY_TABLE: Readonly<Record<BodyKind, string>> = {
  post: "posts",
  comment: "comments",
  message: "messages",
};

/** AUTOINCREMENT ids come from sqlite_sequence; exact inside the write transaction. */
function nextId(db: SwarmDb, kind: BodyKind): number {
  const row = db.sql.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").get(BODY_TABLE[kind]);
  return (row === undefined ? 0 : int(row, "seq")) + 1;
}

/**
 * The body to store for `raw`. Call inside the write transaction right before inserting the row:
 * the attachment is named after that row's id. The path is relative to the project, the agents' cwd.
 */
export function storedBody(
  db: SwarmDb,
  swarmId: number,
  kind: BodyKind,
  raw: string,
  authorKind: ParticipantKind = "agent",
): string {
  const text = requireText(raw, Number.POSITIVE_INFINITY);
  if (authorKind === "user") {
    const head = userPreview(raw);
    if (head.length === raw.length) return text;
    const relative = writeAttachment(db, swarmId, kind, raw);
    return `${head} … [full text: ${relative}]`;
  }
  const ceiling = bodyCeiling(bodyLimit(db));
  if (charCount(text) <= ceiling) return text;
  const relative = writeAttachment(db, swarmId, kind, `${text}\n`);
  return clipWithSuffix(text, `… [full text: ${relative}]`, ceiling);
}

function userPreview(raw: string): string {
  let head = "";
  let count = 0;
  for (const point of raw) {
    if (count === USER_BODY_PREVIEW_CHARS) break;
    head += point;
    count++;
  }
  return head;
}

export function attachmentLocation(db: SwarmDb, swarmId: number, kind: BodyKind, id: number) {
  const project = projectOf(db.dataDir);
  const relative = path.join(path.relative(project, db.dataDir), ATTACHMENTS_DIR, String(swarmId), `${kind}-${id}.md`);
  return { relative, absolute: path.join(project, relative) };
}

function writeAttachment(db: SwarmDb, swarmId: number, kind: BodyKind, contents: string): string {
  const { relative, absolute } = attachmentLocation(db, swarmId, kind, nextId(db, kind));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents);
  return relative;
}
