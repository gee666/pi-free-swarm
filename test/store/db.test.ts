import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  agentSessionFile,
  hasSwarmDb,
  openSwarmDb,
  swarmDataDir,
  swarmDbPath,
  type SwarmDb,
} from "../../src/store/db.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

function pragma(handle: SwarmDb, name: string): unknown {
  const row = handle.sql.prepare(`PRAGMA ${name}`).get();
  return row === undefined ? undefined : Object.values(row)[0];
}

function postCount(handle: SwarmDb): number {
  return Number(handle.sql.prepare("SELECT COUNT(*) AS n FROM posts").get()?.n);
}

describe("openSwarmDb", () => {
  it("creates the folder, applies the schema and configures the connection", () => {
    assert.equal(db.path, swarmDbPath(temp.cwd));
    assert.equal(db.dataDir, swarmDataDir(temp.cwd));
    assert.ok(hasSwarmDb(temp.cwd));
    assert.equal(pragma(db, "user_version"), 1);
    assert.equal(pragma(db, "journal_mode"), "wal");
    assert.equal(pragma(db, "busy_timeout"), 5000);
    assert.equal(pragma(db, "foreign_keys"), 1);
  });

  it("reopens without migrating again", () => {
    const second = openSwarmDb(db.path, { create: false });
    assert.equal(pragma(second, "user_version"), 1);
    second.close();
  });

  it("refuses a missing file without create", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pi-free-swarm-missing-"));
    after(() => rmSync(cwd, { recursive: true, force: true }));
    assert.throws(() => openSwarmDb(swarmDbPath(cwd), { create: false }), /not found/);
    assert.equal(existsSync(swarmDataDir(cwd)), false);
  });

  it("refuses a schema newer than the code", () => {
    const other = createTempDb();
    after(() => other.cleanup());
    other.db.sql.exec("PRAGMA user_version = 2");
    assert.throws(() => openSwarmDb(other.db.path, { create: false }), {
      message: "swarm.db schema v2 is newer than this extension (v1). Update pi-free-swarm.",
    });
  });

  it("builds session paths under the data dir", () => {
    assert.equal(
      agentSessionFile(db.dataDir, 3, "Maria"),
      path.join(db.dataDir, "sessions", "3", "Maria", "session.jsonl"),
    );
  });
});

describe("write", () => {
  const swarm = seedSwarm(db);
  const insertParticipant = (kind: string, status: string | null) =>
    db.sql
      .prepare("INSERT INTO participants (swarm_id, name, kind, status) VALUES (?, 'Ghost', ?, ?)")
      .run(swarm.id, kind, status);
  const insertPost = (title: string, handle: SwarmDb = db) =>
    handle.sql
      .prepare("INSERT INTO posts (swarm_id, author, title, body, created_at) VALUES (?, 'Maria', ?, 'body', ?)")
      .run(swarm.id, title, T0);

  it("rolls back on throw", () => {
    const before = postCount(db);
    assert.throws(() =>
      db.write(() => {
        insertPost("kept?");
        throw new Error("boom");
      }),
    );
    assert.equal(postCount(db), before);
    assert.equal(db.sql.isTransaction, false);
  });

  it("joins nested calls into the outer transaction", () => {
    const before = postCount(db);
    assert.throws(() =>
      db.write(() => {
        db.write(() => insertPost("inner"));
        throw new Error("outer fails");
      }),
    );
    assert.equal(postCount(db), before);
    assert.equal(
      db.write(() => db.write(() => 7)),
      7,
    );
  });

  it("rejects async callbacks", () => {
    const before = postCount(db);
    assert.throws(
      () =>
        db.write(() => {
          insertPost("async");
          return Promise.resolve();
        }),
      { message: "db.write callback must be synchronous" },
    );
    assert.equal(postCount(db), before);
  });

  it("enforces the CHECK constraints", () => {
    assert.throws(() => insertPost("t".repeat(61)), /CHECK constraint failed/);
    assert.throws(() => insertPost(""), /CHECK constraint failed/);
    assert.throws(() => insertParticipant("agent", "sleeping"), /CHECK constraint failed/);
    assert.throws(() => insertParticipant("agent", null), /CHECK constraint failed/);
    assert.throws(() => insertParticipant("user", "idle"), /CHECK constraint failed/);
  });

  it("serialises two handles writing the same file", () => {
    const second = openSwarmDb(db.path, { create: false });
    after(() => second.close());
    const before = postCount(db);
    for (let i = 0; i < 20; i++) {
      const handle = i % 2 === 0 ? db : second;
      handle.write(() => insertPost(`p${i}`, handle));
    }
    assert.equal(postCount(second), before + 20);
  });
});
