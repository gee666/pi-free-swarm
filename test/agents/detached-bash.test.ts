import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { killAllAgentsSync, registerAgentProcess } from "../../src/agents/process-registry.js";

test("exit cleanup gives pi time to kill its tracked detached bash group", async () => {
  const child = spawn(
    process.execPath,
    ["--import", "tsx/esm", fileURLToPath(new URL("./detached-bash-child.ts", import.meta.url))],
    {
      detached: true,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  registerAgentProcess(child);
  let bashPid: number | undefined;
  try {
    const [output] = await once(child.stdout, "data");
    bashPid = Number(String(output).trim());
    assert.ok(Number.isSafeInteger(bashPid) && bashPid > 0);
    const exited = once(child, "exit");
    killAllAgentsSync();
    assert.deepEqual(await exited, [143, null]);
    assert.throws(() => process.kill(Number(bashPid), 0), { code: "ESRCH" });
  } finally {
    child.kill("SIGKILL");
    if (bashPid) {
      try {
        process.kill(-bashPid, "SIGKILL");
      } catch {
        /* already reaped */
      }
    }
  }
});
