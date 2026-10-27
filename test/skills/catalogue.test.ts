import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { SKILL_MAX_FILE_BYTES, SKILL_MAX_FILES, SKILLS_DIR } from "../../src/constants.js";
import { getSkill, searchSkills, syncSkills } from "../../src/skills/index.js";
import { createTempDb } from "../helpers/temp-db.js";

function putSkill(dataDir: string, name: string, text?: string): string {
  const folder = path.join(dataDir, SKILLS_DIR, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, "SKILL.md"),
    text ?? `---\nname: ${name}\ndescription: Automate worktree merges\n---\n# Merge safely\nInstructions.\n`,
  );
  return folder;
}

test("skills sync on read, hash every file, increment revisions only on change, and remove deleted folders", () => {
  const temp = createTempDb();
  try {
    assert.deepEqual(syncSkills(temp.db), { skills: [], changes: [] });
    const folder = putSkill(temp.db.dataDir, "merge");
    mkdirSync(path.join(folder, "scripts"));
    writeFileSync(path.join(folder, "scripts", "merge.sh"), "echo merge\n");
    const first = syncSkills(temp.db, 100);
    assert.deepEqual(first.changes, [{ name: "merge", kind: "added", revision: 1 }]);
    assert.equal(first.skills[0].error, null);
    assert.equal(first.skills[0].title, "Merge safely");
    assert.equal(first.skills[0].path, ".pi/swarm/skills/merge");
    assert.deepEqual(syncSkills(temp.db, 200).changes, []);
    assert.equal(syncSkills(temp.db, 200).skills[0].updatedAt, 100);
    writeFileSync(path.join(folder, "scripts", "merge.sh"), "echo changed\n");
    const updated = getSkill(temp.db, "merge");
    assert.equal(updated.skill?.revision, 2);
    assert.match(updated.skill?.content ?? "", /Instructions/);
    assert.deepEqual(updated.skill?.files, ["SKILL.md", "scripts/merge.sh"]);
    assert.deepEqual(updated.changes, [{ name: "merge", kind: "updated", revision: 2 }]);
    assert.deepEqual(getSkill(temp.db, "merge").changes, []);
    rmSync(folder, { recursive: true });
    assert.deepEqual(syncSkills(temp.db).changes, [{ name: "merge", kind: "removed", revision: 2 }]);
    assert.equal(getSkill(temp.db, "merge").skill, null);
    assert.equal(getSkill(temp.db, "../escape").skill, null);
  } finally {
    temp.cleanup();
  }
});

test("invalid metadata and missing SKILL.md stay indexed, can recover and gain a revision", () => {
  const temp = createTempDb();
  try {
    putSkill(temp.db.dataDir, "mismatch", "---\nname: other\ndescription: desc\n---\n# Wrong\n");
    putSkill(temp.db.dataDir, "no-description", "---\nname: no-description\n---\ntext\n");
    putSkill(temp.db.dataDir, "yaml", "---\nname: [broken\n---\ntext\n");
    mkdirSync(path.join(temp.db.dataDir, SKILLS_DIR, "missing"), { recursive: true });
    const result = syncSkills(temp.db);
    assert.equal(result.skills.length, 4);
    assert.ok(result.skills.every((skill) => skill.error !== null));
    assert.match(result.skills.find((skill) => skill.name === "mismatch")?.error ?? "", /folder name/);
    putSkill(
      temp.db.dataDir,
      "mismatch",
      "---\nname: mismatch\ndescription: |\n  A multiline\n  description.\n---\nNo heading.\n",
    );
    const fixed = getSkill(temp.db, "mismatch").skill;
    assert.equal(fixed?.error, null);
    assert.equal(fixed?.title, "mismatch");
    assert.equal(fixed?.revision, 2);
    assert.match(fixed?.description ?? "", /multiline/);
  } finally {
    temp.cleanup();
  }
});

test("skills search uses name/title/description, lists invalid entries and syncs automatically", async () => {
  const temp = createTempDb();
  try {
    putSkill(temp.db.dataDir, "merge");
    putSkill(
      temp.db.dataDir,
      "lint",
      "---\nname: lint\ndescription: Run eslint checks\n---\n# Lint\nworktree merge instructions are not indexed\n",
    );
    const result = await searchSkills({ db: temp.db, query: "eslint" });
    assert.equal(result.mode, "bm25");
    assert.equal(result.items[0].name, "lint");
    assert.equal(result.changes.length, 2);
    assert.equal((await searchSkills({ db: temp.db, query: "merge" })).items[0].name, "merge");
    const page = await searchSkills({ db: temp.db, limit: 1 });
    assert.ok(page.nextCursor);
    assert.equal((await searchSkills({ db: temp.db, limit: 1, cursor: page.nextCursor })).items.length, 1);
    putSkill(temp.db.dataDir, "invalid", "not a skill");
    const invalid = await searchSkills({ db: temp.db });
    assert.ok(invalid.items.some((skill) => skill.name === "invalid" && skill.error !== null));
  } finally {
    temp.cleanup();
  }
});

test("folder hashing is deterministic and rejects symlinks and bounded file overflows", () => {
  const temp = createTempDb();
  try {
    const folder = putSkill(temp.db.dataDir, "bounded");
    const first = syncSkills(temp.db).skills[0].contentHash;
    const text = getSkill(temp.db, "bounded").skill?.content;
    assert.ok(text);
    writeFileSync(path.join(folder, "SKILL.md"), text);
    assert.equal(syncSkills(temp.db).skills[0].contentHash, first);
    writeFileSync(path.join(folder, "large"), Buffer.alloc(SKILL_MAX_FILE_BYTES + 1));
    assert.match(getSkill(temp.db, "bounded").skill?.error ?? "", /exceeds/);
    rmSync(path.join(folder, "large"));
    symlinkSync(path.join(folder, "SKILL.md"), path.join(folder, "link"));
    assert.match(getSkill(temp.db, "bounded").skill?.error ?? "", /symlinks/);
    rmSync(path.join(folder, "link"));
    for (let index = 0; index < SKILL_MAX_FILES; index++) writeFileSync(path.join(folder, String(index)), "");
    assert.match(getSkill(temp.db, "bounded").skill?.error ?? "", /files or directories/);
  } finally {
    temp.cleanup();
  }
});
