import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { syncSkillsAndNotify } from "../../src/broker/skill-sync.js";
import { getSkill, searchSkills } from "../../src/skills/index.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

test("skill sync notifies every swarm once per change and catalogue reads do not resync", async () => {
  const temp = createTempDb();
  try {
    const first = seedSwarm(temp.db);
    const second = seedSwarm(temp.db, { name: "second" });
    const folder = path.join(temp.db.dataDir, "skills", "checks");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      path.join(folder, "SKILL.md"),
      "---\nname: checks\ndescription: Run tests\n---\n# Tests\nInstructions\n",
    );
    const added = syncSkillsAndNotify(temp.db, T0);
    assert.equal(added.changes.length, 1);
    const events = () =>
      temp.db.sql.prepare("SELECT swarm_id, payload FROM events WHERE type = 'skill.changed' ORDER BY id").all();
    assert.deepEqual(
      events().map((row) => [row.swarm_id, row.payload]),
      [
        [second.id, '{"id":"checks"}'],
        [first.id, '{"id":"checks"}'],
      ],
    );
    assert.deepEqual(syncSkillsAndNotify(temp.db, T0 + 1).changes, []);
    assert.equal(events().length, 2);
    writeFileSync(path.join(folder, "script.sh"), "echo checked\n");
    assert.equal(getSkill(temp.db, "checks").skill?.revision, 1);
    assert.equal((await searchSkills({ db: temp.db })).items[0].revision, 1);
    assert.equal(events().length, 2);
    syncSkillsAndNotify(temp.db, T0 + 2);
    assert.equal(events().length, 4);
    assert.equal(getSkill(temp.db, "checks").skill?.revision, 2);
    rmSync(folder, { recursive: true });
    syncSkillsAndNotify(temp.db, T0 + 3);
    assert.equal(events().length, 6);
    assert.equal(getSkill(temp.db, "checks").skill, null);
  } finally {
    temp.cleanup();
  }
});
