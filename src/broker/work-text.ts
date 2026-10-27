import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ATTACHMENTS_DIR, USER_NAME } from "../constants.js";
import { USER_BODY_PREVIEW_CHARS, charCount } from "../limits.js";
import type { SwarmDb } from "../store/db.js";
import { workText } from "./work-validation.js";

export function storedWorkText(
  db: SwarmDb,
  swarmId: number,
  raw: string,
  field: string,
  actor: string,
  allowEmpty = false,
): string {
  const value = workText(raw, field, actor, false, allowEmpty);
  if (actor !== USER_NAME || charCount(value) <= USER_BODY_PREVIEW_CHARS) return value;
  const relative = path.join(ATTACHMENTS_DIR, String(swarmId), "work", `${randomUUID()}.md`);
  const absolute = path.join(db.dataDir, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
  const reference = path.relative(path.resolve(db.dataDir, "../.."), absolute);
  return `${Array.from(value).slice(0, USER_BODY_PREVIEW_CHARS).join("")} … [full text: ${reference}]`;
}
