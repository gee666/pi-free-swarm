import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { it } from "node:test";

it("does not import the inactive swarm runtime in a fresh process", () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("PI_")) delete env[key];
  const result = spawnSync(process.execPath, ["--import", "tsx/esm", "test/fixtures/startup-imports.ts"], {
    cwd: path.resolve("."),
    env,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stderr}`);
  assert.match(result.stdout, /INACTIVE_IMPORTS_OK/);
});
