import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import piFreeSwarm from "../index.js";
import {
  AGENT_NAME_ENV,
  AGENT_TOOL,
  DB_ENV,
  MAIN_TOOL,
  ROLE_ENV,
  RUNNER_PID_ENV,
  SWARM_ID_ENV,
} from "../src/constants.js";
import { readAgentEnv } from "../src/agent-mode.js";
import { createSwarm } from "../src/broker/swarms.js";
import { registerActiveRun } from "../src/broker/active-ownership.js";
import { createMainRuntime, registerMainMode, type BoardHost } from "../src/main-runtime.js";
import { openSwarmDb, swarmDbPath } from "../src/store/db.js";
import { getSwarm } from "../src/store/swarm-queries.js";
import { FakeExtensionApi } from "./helpers/fake-extension-api.js";

// pi's full API must satisfy the slice the extension is written against.
const factory: ExtensionFactory = piFreeSwarm;

const dirs: string[] = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function project(): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-free-swarm-index-"));
  dirs.push(cwd);
  return cwd;
}

/** Each test file runs in its own process, so the role variables can be set here. */
function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key];
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function recordingHost() {
  const calls: string[] = [];
  const host: BoardHost = {
    start: () => void calls.push("start"),
    ensure: async () => null,
    boardUrl: () => null,
    stop: async () => void calls.push("stop"),
    releaseSync: () => void calls.push("releaseSync"),
  };
  return { host, calls };
}

describe("role detection", () => {
  it("is loadable as a pi ExtensionFactory", () => assert.equal(typeof factory, "function"));

  it("main mode registers only swarm and resume_swarm", () => {
    const pi = new FakeExtensionApi();
    withEnv({ [ROLE_ENV]: undefined }, () => piFreeSwarm(pi));
    assert.deepEqual(pi.toolNames(), [MAIN_TOOL.swarm, MAIN_TOOL.resumeSwarm]);
  });

  it("agent mode registers only the swarm_* tools, never swarm/resume_swarm", () => {
    const pi = new FakeExtensionApi();
    const agentEnv = {
      [ROLE_ENV]: "agent",
      [DB_ENV]: "/abs/.pi/swarm/swarm.db",
      [SWARM_ID_ENV]: "3",
      [AGENT_NAME_ENV]: "Maria",
      [RUNNER_PID_ENV]: String(process.pid),
    };
    withEnv(agentEnv, () => piFreeSwarm(pi));
    assert.deepEqual(pi.toolNames(), Object.values(AGENT_TOOL));
  });

  it("agent mode without its identity registers nothing and says what is missing", () => {
    const pi = new FakeExtensionApi();
    withEnv({ [ROLE_ENV]: "agent", [DB_ENV]: "/x.db", [SWARM_ID_ENV]: "0", [AGENT_NAME_ENV]: undefined }, () =>
      piFreeSwarm(pi),
    );
    assert.deepEqual(pi.toolNames(), []);
    const parsed = readAgentEnv({ [DB_ENV]: "/x.db", [SWARM_ID_ENV]: "0", [RUNNER_PID_ENV]: "12" });
    assert.deepEqual(parsed, {
      ok: false,
      error: `pi-free-swarm agent mode: missing or invalid ${SWARM_ID_ENV}, ${AGENT_NAME_ENV}; swarm tools disabled.`,
    });
  });
});

describe("main mode lifecycle", () => {
  it("routes server errors to the session notification UI", async () => {
    const pi = new FakeExtensionApi();
    const { host } = recordingHost();
    let report: ((message: string) => void) | undefined;
    const runtime = createMainRuntime({
      cwd: project(),
      extensionPath: "/abs/index.ts",
      createHost: (options) => {
        report = options.onError;
        return host;
      },
    });
    registerMainMode(pi, runtime);
    pi.startSession();
    assert.ok(report);
    report("Board request failed: test error");
    assert.deepEqual(pi.notes, ["Board request failed: test error"]);
    await pi.shutdownSession();
  });

  it("startup sweep protects owned active runs but interrupts abandoned same-pid runs", async () => {
    const cwd = project();
    const { host } = recordingHost();
    const pi = new FakeExtensionApi();
    const runtime = createMainRuntime({ cwd, extensionPath: "/abs/index.ts", createHost: () => host });
    const db = runtime.getDb(true);
    assert.ok(db);
    const input = { taskPrompt: "t", agentNames: ["Maria"], runnerPid: process.pid, now: Date.now() - 60_000 };
    const active = createSwarm(db, { ...input, name: "active" });
    const abandoned = createSwarm(db, { ...input, name: "abandoned" });
    const unregister = registerActiveRun(db, active.id, process.pid);
    try {
      registerMainMode(pi, runtime);
      pi.startSession();
      assert.equal(getSwarm(db, active.id, Date.now())?.status, "starting");
      assert.equal(getSwarm(db, abandoned.id, Date.now())?.status, "interrupted");
    } finally {
      unregister();
      await pi.shutdownSession();
    }
  });

  it("does not host on session_start while the project has no swarm.db", async () => {
    const cwd = project();
    const { host, calls } = recordingHost();
    const pi = new FakeExtensionApi();
    registerMainMode(pi, createMainRuntime({ cwd, extensionPath: "/abs/index.ts", createHost: () => host }));
    pi.startSession();
    await pi.shutdownSession();
    assert.deepEqual(calls, ["stop"]);
  });

  it("with a swarm.db: sweeps stale runs and hosts on start, stops and closes on shutdown", async () => {
    const cwd = project();
    const seed = openSwarmDb(swarmDbPath(cwd), { create: true });
    // A runner pid that cannot be alive: its run is stale.
    createSwarm(seed, { name: "old", taskPrompt: "t", agentNames: ["Maria"], runnerPid: 2 ** 22 + 1, now: Date.now() });
    seed.close();

    const { host, calls } = recordingHost();
    const pi = new FakeExtensionApi();
    const runtime = createMainRuntime({ cwd, extensionPath: "/abs/index.ts", createHost: () => host });
    registerMainMode(pi, runtime);
    pi.startSession();
    assert.deepEqual(calls, ["start"]);
    const db = runtime.getDb(false);
    assert.ok(db);
    assert.equal(getSwarm(db, 1, Date.now())?.status, "interrupted");
    const row = db.sql.prepare("SELECT status FROM swarms WHERE id = 1").get();
    assert.equal(row?.status, "interrupted");

    await pi.shutdownSession();
    assert.deepEqual(calls, ["start", "stop"]);
    assert.throws(() => db.sql.prepare("SELECT 1").get(), /not open/);
  });

  it("adds one process exit listener however often main mode is registered", () => {
    const before = process.listenerCount("exit");
    for (let index = 0; index < 3; index++) {
      const { host } = recordingHost();
      registerMainMode(
        new FakeExtensionApi(),
        createMainRuntime({ cwd: project(), extensionPath: "/abs/index.ts", createHost: () => host }),
      );
    }
    assert.ok(process.listenerCount("exit") - before <= 1);
  });
});
