import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ATTACHMENTS_DIR, USER_NAME, MAIN_NAME } from "../constants.js";
import { USER_BODY_PREVIEW_CHARS, charCount } from "../limits.js";
import type { SwarmDb } from "../store/db.js";
import { workText } from "./work-validation.js";

export function fullWorkText(db: SwarmDb, value: string): string {
  const reference = / … \[full text: ([^\n]+)\]$/.exec(value)?.[1];
  if (!reference) return value;
  const absolute = path.resolve(db.dataDir, "../..", reference);
  const relative = path.relative(path.join(db.dataDir, ATTACHMENTS_DIR), absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return value;
  return readFileSync(absolute, "utf8");
}

export function storedWorkText(
  db: SwarmDb,
  swarmId: number,
  raw: string,
  field: string,
  actor: string,
  allowEmpty = false,
): string {
  const unrestricted = actor === USER_NAME || actor === MAIN_NAME;
  const value = workText(raw, field, unrestricted ? USER_NAME : actor, false, allowEmpty);
  if (!unrestricted || charCount(value) <= USER_BODY_PREVIEW_CHARS) return value;
  const relative = path.join(ATTACHMENTS_DIR, String(swarmId), "work", `${randomUUID()}.md`);
  const absolute = path.join(db.dataDir, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
  const reference = path.relative(path.resolve(db.dataDir, "../.."), absolute);
  return `${Array.from(value).slice(0, USER_BODY_PREVIEW_CHARS).join("")} … [full text: ${reference}]`;
}
