import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import path from "node:path";
import {
  SKILL_FILE,
  SKILL_MAX_DEPTH,
  SKILL_MAX_FILE_BYTES,
  SKILL_MAX_FILES,
  SKILL_MAX_TOTAL_BYTES,
} from "../constants.js";

export interface SkillFiles {
  hash: string;
  files: string[];
  text: string | null;
  error: string | null;
}

export function readSkillFolder(folder: string): SkillFiles {
  const hash = createHash("sha256");
  const contents: { relative: string; content: Buffer }[] = [];
  let text: string | null = null;
  let total = 0;
  let entries = 0;
  let error: string | null = null;
  try {
    if (!lstatSync(folder).isDirectory()) throw new Error("skill folder must be a directory, not a symlink");
    walk(folder, "", 0);
    if (text === null) throw new Error(`missing ${SKILL_FILE}`);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "cannot read skill folder";
  }
  contents.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
  for (const { relative, content } of contents) {
    // Lengths prevent a path/content boundary from producing the same hash as another folder.
    hash.update(JSON.stringify([relative, content.length]));
    hash.update(content);
  }
  if (error !== null) hash.update(JSON.stringify({ error }));
  return { hash: hash.digest("hex"), files: contents.map((file) => file.relative), text, error };

  function walk(directory: string, prefix: string, depth: number): void {
    if (depth > SKILL_MAX_DEPTH) throw new Error(`skill exceeds directory depth ${SKILL_MAX_DEPTH}`);
    for (const name of readdirSync(directory).sort()) {
      entries++;
      if (entries > SKILL_MAX_FILES) throw new Error(`skill exceeds ${SKILL_MAX_FILES} files or directories`);
      const relative = prefix ? `${prefix}/${name}` : name;
      const absolute = path.join(directory, name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`symlinks are not allowed: ${relative}`);
      if (stat.isDirectory()) {
        walk(absolute, relative, depth + 1);
        continue;
      }
      if (!stat.isFile()) throw new Error(`not a regular file: ${relative}`);
      if (stat.size > SKILL_MAX_FILE_BYTES) throw new Error(`file exceeds ${SKILL_MAX_FILE_BYTES} bytes: ${relative}`);
      const content = boundedRead(absolute);
      total += content.length;
      if (total > SKILL_MAX_TOTAL_BYTES) throw new Error(`skill exceeds ${SKILL_MAX_TOTAL_BYTES} total bytes`);
      contents.push({ relative, content });
      if (relative === SKILL_FILE) text = content.toString("utf8");
    }
  }
}

function boundedRead(file: string): Buffer {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(descriptor).isFile()) throw new Error("not a regular file");
    const buffer = Buffer.alloc(SKILL_MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > SKILL_MAX_FILE_BYTES) throw new Error(`file exceeds ${SKILL_MAX_FILE_BYTES} bytes`);
    return buffer.subarray(0, length);
  } finally {
    closeSync(descriptor);
  }
}
