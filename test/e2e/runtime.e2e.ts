import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import { openSwarmDb, swarmDbPath, SCHEMA_VERSION } from "../../src/store/db.js";

it("installed Pi loads the extension, uses SQLite, serves the board and relaunches itself", { timeout: 60_000 }, () => {
  const root = path.resolve("tmp");
  mkdirSync(root, { recursive: true });
  const cwd = mkdtempSync(path.join(root, "runtime-e2e-"));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("PI_SWARM_")) delete env[key];
  try {
    const result = spawnSync(
      process.env.EVERGREEN_PI_BIN || "pi",
      [
        "-p",
        "--no-session",
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--no-prompt-templates",
        "--approve",
        "-e",
        path.resolve("."),
        "-e",
        path.resolve("test/fixtures/runtime-probe.ts"),
        "--",
        "/swarm-runtime-probe",
      ],
      { cwd, env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 50_000 },
    );
    assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stderr}\n${result.stdout}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /SWARM_RUNTIME_OK/);
    const db = openSwarmDb(swarmDbPath(cwd), { create: false });
    try {
      assert.equal(db.sql.prepare("SELECT value FROM runtime_probe WHERE id = 1").get()?.value, "persisted");
      assert.equal(db.sql.prepare("PRAGMA user_version").get()?.user_version, SCHEMA_VERSION);
    } finally {
      db.close();
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
