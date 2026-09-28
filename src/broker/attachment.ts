// Over-long communication bodies: rejecting one costs the author a retry turn, so the full text goes
// to a file and the stored body is its head plus the file's path.
import fs from "node:fs";
import path from "node:path";
import { ATTACHMENTS_DIR } from "../constants.js";
import { bodyCeiling, charCount, clipWithSuffix } from "../limits.js";
import type { SwarmDb } from "../store/db.js";
import { int } from "../store/rows.js";
import { bodyLimit, projectOf } from "./body-limit.js";
import { requireText } from "./validate.js";

export type BodyKind = "post" | "comment" | "message";

const TABLE: Record<BodyKind, string> = { post: "posts", comment: "comments", message: "messages" };

/** AUTOINCREMENT ids come from sqlite_sequence; exact inside the write transaction. */
function nextId(db: SwarmDb, kind: BodyKind): number {
  const row = db.sql.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").get(TABLE[kind]);
  return (row === undefined ? 0 : int(row, "seq")) + 1;
}

/**
 * The body to store for `raw`. Call inside the write transaction right before inserting the row:
 * the attachment is named after that row's id. The path is relative to the project, the agents' cwd.
 */
export function storedBody(db: SwarmDb, swarmId: number, kind: BodyKind, raw: string): string {
  const text = requireText(raw, Number.POSITIVE_INFINITY);
  const ceiling = bodyCeiling(bodyLimit(db));
  if (charCount(text) <= ceiling) return text;
  const project = projectOf(db.dataDir);
  const relative = path.join(
    path.relative(project, db.dataDir),
    ATTACHMENTS_DIR,
    String(swarmId),
    `${kind}-${nextId(db, kind)}.md`,
  );
  const absolute = path.join(project, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${text}\n`);
  return clipWithSuffix(text, `… [full text: ${relative}]`, ceiling);
}
