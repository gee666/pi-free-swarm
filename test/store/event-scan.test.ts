import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { insertEvent, scanEventsAfter, latestEventId, pruneEvents, eventRetentionGap } from "../../src/store/events.js";
import { openSwarmDb } from "../../src/store/db.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

function unknownRows(db: ReturnType<typeof createTempDb>["db"], swarmId: number, count: number): void {
  db.write((tx) => {
    const insert = tx.sql.prepare(
      "INSERT INTO events (swarm_id, type, payload, created_at) VALUES (?, 'future', '{}', ?)",
    );
    for (let i = 0; i < count; i++) insert.run(swarmId, T0);
  });
}

describe("raw outbox scan and retention", () => {
  it("adds retention metadata to a v4 database without inventing historical deletion evidence", () => {
    const dir = mkdtempSync(path.resolve("tmp/swarm-implementation/event-migration-"));
    const file = path.join(dir, "swarm.db");
    try {
      const legacy = new DatabaseSync(file);
      for (const name of ["schema.sql", "002-communication.sql", "acceptance.sql", "004-acceptance-votes.sql"]) {
        legacy.exec(readFileSync(new URL(`../../src/store/${name}`, import.meta.url), "utf8"));
      }
      legacy.exec("PRAGMA user_version = 4");
      legacy.close();
      const migrated = openSwarmDb(file, { create: false });
      try {
        assert.deepEqual(migrated.sql.prepare("SELECT * FROM event_retention").all(), []);
        assert.equal(eventRetentionGap(migrated, 1, 0), null);
        assert.deepEqual(migrated.sql.prepare("PRAGMA foreign_key_check").all(), []);
      } finally {
        migrated.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("advances through full unknown-only pages to later known events", (t) => {
    const temp = createTempDb();
    t.after(temp.cleanup);
    const swarm = seedSwarm(temp.db);
    const after = latestEventId(temp.db);
    unknownRows(temp.db, swarm.id, 1_000);
    const known = insertEvent(temp.db, swarm.id, "session.appended", { agent: "Maria", newestCursor: "1" }, T0);
    const first = scanEventsAfter(temp.db, after, 500);
    assert.deepEqual(first.events, []);
    assert.equal(first.scannedThrough, after + 500);
    assert.equal(first.hasMore, true);
    const second = scanEventsAfter(temp.db, first.scannedThrough, 500);
    assert.equal(second.scannedThrough, after + 1_000);
    assert.equal(second.hasMore, true);
    const third = scanEventsAfter(temp.db, second.scannedThrough, 500);
    assert.deepEqual(
      third.events.map((event) => event.id),
      [known],
    );
    assert.equal(third.hasMore, false);
  });

  it("keeps snapshot scan boundaries stable when another writer appends", (t) => {
    const temp = createTempDb();
    t.after(temp.cleanup);
    const swarm = seedSwarm(temp.db);
    unknownRows(temp.db, swarm.id, 3);
    const boundary = latestEventId(temp.db);
    const second = openSwarmDb(temp.db.path, { create: false });
    t.after(() => second.close());
    const appended = insertEvent(second, swarm.id, "session.appended", { agent: "Maria", newestCursor: "1" }, T0);
    const page = scanEventsAfter(temp.db, 0, 500, boundary);
    assert.equal(page.scannedThrough, boundary);
    assert.ok(page.events.every((event) => event.id !== appended));
    assert.equal(scanEventsAfter(temp.db, boundary, 500).events[0].id, appended);
  });

  it("reports malformed known JSON explicitly and skips unsupported payloads", (t) => {
    const temp = createTempDb();
    t.after(temp.cleanup);
    const swarm = seedSwarm(temp.db);
    const before = latestEventId(temp.db);
    temp.db.sql
      .prepare("INSERT INTO events (swarm_id, type, payload, created_at) VALUES (?, 'future', 'bad', ?)")
      .run(swarm.id, T0);
    assert.doesNotThrow(() => scanEventsAfter(temp.db, before, 10));
    temp.db.sql
      .prepare("INSERT INTO events (swarm_id, type, payload, created_at) VALUES (?, 'usage.updated', 'bad', ?)")
      .run(swarm.id, T0);
    assert.throws(() => scanEventsAfter(temp.db, before, 10), /Invalid payload for event #\d+ \(usage.updated\)/);
  });

  it("records only genuine per-stream deletion gaps and survives empty history/restart", (t) => {
    const temp = createTempDb();
    t.after(temp.cleanup);
    const a = seedSwarm(temp.db);
    const b = seedSwarm(temp.db, { name: "other" });
    const before = latestEventId(temp.db);
    const deleted = insertEvent(temp.db, a.id, "session.appended", { agent: "Maria", newestCursor: "1" }, T0);
    const kept = insertEvent(temp.db, b.id, "session.appended", { agent: "Maria", newestCursor: "1" }, T0 + 100);
    pruneEvents(temp.db, T0 + 1);
    assert.equal(eventRetentionGap(temp.db, a.id, before), deleted);
    assert.equal(eventRetentionGap(temp.db, b.id, before), null);
    assert.equal(eventRetentionGap(temp.db, null, before), null, "picker ignores pruned usage events");
    assert.equal(eventRetentionGap(temp.db, a.id, deleted), null);
    pruneEvents(temp.db, T0 + 101);
    assert.equal(latestEventId(temp.db), kept, "pruning all rows does not reset monotonic scan boundary");
    const reopened = openSwarmDb(temp.db.path, { create: false });
    t.after(() => reopened.close());
    assert.equal(eventRetentionGap(reopened, a.id, before), deleted);
    assert.equal(latestEventId(reopened), kept);
  });

  it("rolls nested state/outbox and retention writes back together", (t) => {
    const temp = createTempDb();
    t.after(temp.cleanup);
    const swarm = seedSwarm(temp.db);
    const before = latestEventId(temp.db);
    assert.throws(
      () =>
        temp.db.write((tx) => {
          tx.sql.prepare("UPDATE swarms SET name = 'changed' WHERE id = ?").run(swarm.id);
          temp.db.write((nested) =>
            insertEvent(nested, swarm.id, "session.appended", { agent: "Maria", newestCursor: "1" }, T0),
          );
          pruneEvents(temp.db, T0 + 1);
          throw new Error("rollback");
        }),
      /rollback/,
    );
    assert.equal(latestEventId(temp.db), before);
    assert.equal(temp.db.sql.prepare("SELECT name FROM swarms WHERE id = ?").get(swarm.id)?.name, swarm.name);
    assert.equal(eventRetentionGap(temp.db, swarm.id, 0), null);
  });
});
