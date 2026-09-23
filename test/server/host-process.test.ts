import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { openSwarmDb, swarmDbPath, type SwarmDb } from "../../src/store/db.js";
import { readServerHost, type ServerHostRow } from "../../src/store/locks.js";
import { createUiFixture, waitFor } from "./helpers.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const hostChild = fileURLToPath(new URL("./fixtures/host-child.ts", import.meta.url));
const POLL_MS = 250;
/** Takeover budget: one poll plus process scheduling, far below the production 5 s poll. */
const TAKEOVER_MS = 5_000;
const PORT_RANGE = 10;
// A random high range so parallel runs and a real board on 3010 don't collide.
const firstPort = 20_000 + Math.floor(Math.random() * 30_000);

const project = mkdtempSync(path.join(tmpdir(), "pi-free-swarm-hosts-"));
const ui = createUiFixture();
const children: ChildProcess[] = [];
let db: SwarmDb | null = null;

after(() => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  db?.close();
  rmSync(project, { recursive: true, force: true });
  ui.cleanup();
});

function startChild(): Promise<ChildProcess> {
  const args = [hostChild, project, ui.dir, String(POLL_MS), String(firstPort), String(firstPort + PORT_RANGE - 1)];
  const child = spawn(process.execPath, ["--import", "tsx/esm", ...args], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "inherit"],
  });
  children.push(child);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout?.once("data", () => resolve(child));
  });
}

function currentHost(): ServerHostRow | null {
  db ??= openSwarmDb(swarmDbPath(project), { create: false });
  return readServerHost(db, Date.now());
}

async function servesBoard(port: number): Promise<boolean> {
  return fetch(`http://127.0.0.1:${port}/api/swarms`).then(
    (response) => response.ok,
    () => false,
  );
}

describe("two pi processes in one folder", () => {
  it("elect exactly one host, which a SIGKILL hands to the other within a poll, on the same port", async () => {
    const [one, two] = await Promise.all([startChild(), startChild()]);
    const first = await waitFor(currentHost, TAKEOVER_MS, "a host");
    const pids = [one.pid, two.pid];
    assert.ok(pids.includes(first.pid));
    assert.ok(await servesBoard(first.port));

    // Several polls later the same process still hosts: nobody fights over the row.
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 4));
    const stable = currentHost();
    assert.equal(stable?.pid, first.pid);
    assert.ok(stable !== null && stable.heartbeatAt > first.heartbeatAt, "the host keeps heartbeating");

    const [host, other] = first.pid === one.pid ? [one, two] : [two, one];
    const exited = new Promise((resolve) => host.once("exit", resolve));
    const killedAt = Date.now();
    host.kill("SIGKILL");
    await exited;
    const next = await waitFor(
      () => {
        const row = currentHost();
        return row !== null && row.pid === other.pid ? row : null;
      },
      TAKEOVER_MS,
      "takeover",
    );
    assert.ok(Date.now() - killedAt < TAKEOVER_MS);
    assert.equal(next.port, first.port, "the board URL survives the takeover");
    assert.ok(await servesBoard(next.port));
  });
});
