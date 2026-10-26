import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getPiCommand } from "../../src/agents/launch.js";
import { ServerHost } from "../../src/server/host.js";
import { openSwarmDb, swarmDbPath } from "../../src/store/db.js";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("swarm-runtime-probe", {
    description: "Check SQLite and the board in the installed Pi runtime without model calls",
    handler: async (_args, ctx) => {
      const db = openSwarmDb(swarmDbPath(ctx.cwd), { create: true });
      const host = new ServerHost({
        cwd: ctx.cwd,
        getDb: () => db,
        uiDir: ctx.cwd,
        ports: () => ({ candidates: [0], explicit: true }),
        onError: (message) => {
          throw new Error(message);
        },
      });
      try {
        assert.equal(db.sql.prepare("SELECT 1 WHERE 0").get(), undefined);
        assert.equal(db.sql.prepare("SELECT NULL AS value").get()?.value, null);
        assert.deepEqual(db.sql.prepare("SELECT 1 WHERE 0").all(), []);
        assert.equal(db.sql.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
        assert.equal(db.sql.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
        db.sql.exec("CREATE TABLE runtime_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
        const result = db.write(() => {
          assert.equal(db.sql.isTransaction, true);
          return db.sql.prepare("INSERT INTO runtime_probe (value) VALUES (?)").run("persisted");
        });
        assert.equal(Number(result.changes), 1);
        assert.equal(Number(result.lastInsertRowid), 1);
        assert.equal(db.sql.isTransaction, false);
        assert.throws(() =>
          db.write(() => {
            db.sql.prepare("INSERT INTO runtime_probe (value) VALUES (?)").run("rolled back");
            throw new Error("rollback probe");
          }),
        );
        assert.equal(db.sql.prepare("SELECT count(*) AS n FROM runtime_probe").get()?.n, 1);
        const url = await host.ensure();
        assert.ok(url, "board starts in the actual runtime");
        const response = await fetch(`${url}/api/swarms`);
        assert.equal(response.status, 200);
        await response.json();
        const command = getPiCommand();
        assert.equal(command.command, process.execPath);
        if (process.versions.bun && process.argv[1]?.startsWith("/$bunfs/")) {
          assert.deepEqual(command.argsPrefix, [], "compiled Pi must not depend on PATH for worker launch");
        }
        const child = spawnSync(command.command, [...command.argsPrefix, "--version"], {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 15_000,
        });
        assert.equal(child.status, 0, child.stderr?.toString());
        console.log(`SWARM_RUNTIME_OK ${JSON.stringify({ bun: process.versions.bun ?? null })}`);
      } finally {
        await host.stop();
        db.close();
      }
    },
  });
}
