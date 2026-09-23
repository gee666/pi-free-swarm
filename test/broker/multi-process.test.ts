import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { heartbeatRunLock } from "../../src/store/locks.js";
import { createTempDb, seedSwarm } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const writer = fileURLToPath(new URL("./fixtures/concurrent-writer.ts", import.meta.url));
const WRITES = 150;

function runWriter(author: string, startAt: number): Promise<{ code: number | null; stderr: string }> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx/esm", writer, db.path, String(swarmId), author, String(WRITES), String(startAt)],
    { cwd: repoRoot, stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  return new Promise((resolve) => child.on("close", (code) => resolve({ code, stderr })));
}

const swarmId = seedSwarm(db, { now: Date.now() }).id;

function count(sql: string): number {
  return Number(db.sql.prepare(sql).get()?.n);
}

describe("two processes writing one swarm.db", () => {
  it("loses no rows and hits no busy errors", { timeout: 60_000 }, async () => {
    const startAt = Date.now() + 2_000;
    const results = Promise.all([runWriter("Maria", startAt), runWriter("John", startAt)]);
    // This process keeps writing too, like a runner heartbeating while agents post.
    const heartbeat = setInterval(() => heartbeatRunLock(db, swarmId, process.pid, Date.now()), 5);
    const [maria, john] = await results;
    clearInterval(heartbeat);
    assert.deepEqual([maria.code, maria.stderr], [0, ""]);
    assert.deepEqual([john.code, john.stderr], [0, ""]);

    const perWriter = WRITES / 2;
    assert.equal(count("SELECT COUNT(*) AS n FROM posts"), 2 * perWriter);
    assert.equal(count("SELECT COUNT(*) AS n FROM messages"), 2 * perWriter);
    assert.equal(count("SELECT COUNT(*) AS n FROM message_recipients"), 2 * 2 * perWriter);
    assert.equal(count("SELECT COUNT(*) AS n FROM events WHERE type = 'post.created'"), 2 * perWriter);
    assert.equal(count("SELECT COUNT(*) AS n FROM events WHERE type = 'message.created'"), 2 * perWriter);
    assert.equal(count("SELECT COUNT(*) AS n FROM message_recipients WHERE status = 'pending'"), 2 * perWriter);
    const authors = db.sql
      .prepare("SELECT author FROM posts ORDER BY id")
      .all()
      .map((row) => row.author);
    const switches = authors.filter((author, i) => i > 0 && author !== authors[i - 1]).length;
    assert.ok(switches > 2, `writers did not overlap (${switches} switches)`);
  });
});
