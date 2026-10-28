import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import piFreeSwarm from "../index.js";
import {
  AGENT_NAME_ENV,
  AGENT_TOOL,
  DB_ENV,
  ENABLED_ENV,
  ENABLE_FLAG,
  MAIN_TOOL,
  ROLE_ENV,
  RUNNER_PID_ENV,
  RUN_ENV,
  SWARM_ID_ENV,
  WATCHER_NAME,
  WATCHER_TOOLS,
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
  const root = path.resolve("tmp");
  mkdirSync(root, { recursive: true });
  const cwd = mkdtempSync(path.join(root, "pi-free-swarm-index-"));
  dirs.push(cwd);
  return cwd;
}

/** Each test file runs in its own process, so the role variables can be set here. */
async function withEnv(values: Record<string, string | undefined>, run: () => void | Promise<void>): Promise<void> {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key];
  try {
    await run();
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

  for (const enabled of [undefined, "0", "false", "TRUE", " true", "yes"]) {
    it(`main mode stays disabled with env ${String(enabled)}, even with existing data`, async () => {
      const cwd = project();
      const db = openSwarmDb(swarmDbPath(cwd), { create: true });
      createSwarm(db, {
        name: "old",
        taskPrompt: "t",
        acceptanceCriteria: ["Task complete."],
        agentNames: ["Maria"],
        runnerPid: 2 ** 22 + 1,
        now: Date.now(),
      });
      const pi = new FakeExtensionApi();
      const before = process.listenerCount("exit");
      try {
        await withEnv({ [ROLE_ENV]: undefined, [ENABLED_ENV]: enabled }, async () => {
          await piFreeSwarm(pi);
          await pi.startSession(cwd);
        });
        assert.deepEqual(pi.toolNames(), []);
        assert.equal(pi.getFlag(ENABLE_FLAG), false);
        assert.equal(process.listenerCount("exit"), before);
        await pi.shutdownSession();
        assert.equal(db.sql.prepare("SELECT status FROM swarms WHERE id = 1").get()?.status, "starting");
        assert.equal(db.sql.prepare("SELECT COUNT(*) AS count FROM server_host").get()?.count, 0);
      } finally {
        db.close();
      }
    });
  }

  for (const enabled of [undefined, "0", "false", "1", "true"]) {
    const byFlag = enabled !== "1" && enabled !== "true";
    it(`main mode activates once by ${byFlag ? "flag" : `env ${enabled}`}`, async () => {
      const cwd = project();
      const pi = new FakeExtensionApi();
      await withEnv({ [ROLE_ENV]: undefined, [ENABLED_ENV]: enabled }, async () => {
        await piFreeSwarm(pi);
        assert.deepEqual(pi.toolNames(), []);
        assert.equal(pi.flags.get(ENABLE_FLAG)?.type, "boolean");
        if (byFlag) pi.flagValues.set(ENABLE_FLAG, true);
        await pi.startSession(cwd);
        await pi.startSession(cwd);
      });
      assert.deepEqual(pi.toolNames(), Object.values(MAIN_TOOL));
      assert.equal(existsSync(swarmDbPath(cwd)), false);
      await pi.shutdownSession();
    });
  }

  it("activation sweeps the session cwd on its first session_start", async () => {
    const cwd = project();
    assert.notEqual(cwd, process.cwd());
    const db = openSwarmDb(swarmDbPath(cwd), { create: true });
    createSwarm(db, {
      name: "old",
      taskPrompt: "t",
      acceptanceCriteria: ["Task complete."],
      agentNames: ["Maria"],
      runnerPid: 2 ** 22 + 1,
      now: Date.now(),
    });
    const pi = new FakeExtensionApi();
    try {
      await withEnv({ [ROLE_ENV]: undefined, [ENABLED_ENV]: "true" }, async () => {
        await piFreeSwarm(pi);
        await pi.startSession(cwd);
      });
      assert.equal(db.sql.prepare("SELECT status FROM swarms WHERE id = 1").get()?.status, "interrupted");
    } finally {
      await pi.shutdownSession();
      db.close();
    }
  });

  it("agent mode registers only the swarm_* tools, never swarm/resume_swarm", async () => {
    const pi = new FakeExtensionApi();
    const agentEnv = {
      [ROLE_ENV]: "agent",
      [ENABLED_ENV]: "false",
      [DB_ENV]: "/abs/.pi/swarm/swarm.db",
      [SWARM_ID_ENV]: "3",
      [AGENT_NAME_ENV]: "Maria",
      [RUNNER_PID_ENV]: String(process.pid),
      [RUN_ENV]: "1",
    };
    await withEnv(agentEnv, () => piFreeSwarm(pi));
    assert.deepEqual(pi.toolNames().sort(), Object.values(AGENT_TOOL).sort());
    assert.equal(pi.flags.size, 0);
  });

  it("Watcher gets agent-mode tools without opt-in", async () => {
    const pi = new FakeExtensionApi();
    await withEnv(
      {
        [ROLE_ENV]: "agent",
        [ENABLED_ENV]: "0",
        [DB_ENV]: "/abs/.pi/swarm/swarm.db",
        [SWARM_ID_ENV]: "3",
        [AGENT_NAME_ENV]: WATCHER_NAME,
        [RUNNER_PID_ENV]: String(process.pid),
        [RUN_ENV]: "1",
      },
      () => piFreeSwarm(pi),
    );
    assert.deepEqual(pi.toolNames().sort(), [...WATCHER_TOOLS].sort());
    assert.equal(pi.flags.size, 0);
  });

  it("agent mode without its identity registers nothing and says what is missing", async () => {
    const pi = new FakeExtensionApi();
    await withEnv({ [ROLE_ENV]: "agent", [DB_ENV]: "/x.db", [SWARM_ID_ENV]: "0", [AGENT_NAME_ENV]: undefined }, () =>
      piFreeSwarm(pi),
    );
    assert.deepEqual(pi.toolNames(), []);
    const parsed = readAgentEnv({ [DB_ENV]: "/x.db", [SWARM_ID_ENV]: "0", [RUNNER_PID_ENV]: "12" });
    assert.deepEqual(parsed, {
      ok: false,
      error: `pi-free-swarm agent mode: missing or invalid ${SWARM_ID_ENV}, ${AGENT_NAME_ENV}, ${RUN_ENV}; swarm tools disabled.`,
    });
  });
});

describe("main mode lifecycle", () => {
  it("starts from the initial context without waiting for another session_start", async () => {
    const cwd = project();
    const { host, calls } = recordingHost();
    const pi = new FakeExtensionApi();
    const runtime = createMainRuntime({ cwd, extensionPath: "/abs/index.ts", createHost: () => host });
    assert.ok(runtime.getDb(true));
    registerMainMode(pi, runtime, {
      cwd,
      hasUI: true,
      ui: { notify: (message) => void pi.notes.push(message) },
      abort: () => void pi.aborted++,
      shutdown: () => void pi.shutdowns++,
    });
    assert.deepEqual(calls, ["start"]);
    runtime.notify("initial context attached", "info");
    assert.deepEqual(pi.notes, ["initial context attached"]);
    await pi.shutdownSession();
    assert.deepEqual(calls, ["start", "stop"]);
  });

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
    await pi.startSession();
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
    const input = {
      taskPrompt: "t",
      acceptanceCriteria: ["Task complete."],
      agentNames: ["Maria"],
      runnerPid: process.pid,
      now: Date.now() - 60_000,
    };
    const active = createSwarm(db, { ...input, name: "active" });
    const abandoned = createSwarm(db, { ...input, name: "abandoned" });
    const unregister = registerActiveRun(db, active.id, process.pid);
    try {
      registerMainMode(pi, runtime);
      await pi.startSession();
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
    await pi.startSession();
    await pi.shutdownSession();
    assert.deepEqual(calls, ["stop"]);
  });

  it("with a swarm.db: sweeps stale runs and hosts on start, stops and closes on shutdown", async () => {
    const cwd = project();
    const seed = openSwarmDb(swarmDbPath(cwd), { create: true });
    // A runner pid that cannot be alive: its run is stale.
    createSwarm(seed, {
      name: "old",
      taskPrompt: "t",
      acceptanceCriteria: ["Task complete."],
      agentNames: ["Maria"],
      runnerPid: 2 ** 22 + 1,
      now: Date.now(),
    });
    seed.close();

    const { host, calls } = recordingHost();
    const pi = new FakeExtensionApi();
    const runtime = createMainRuntime({ cwd, extensionPath: "/abs/index.ts", createHost: () => host });
    registerMainMode(pi, runtime);
    await pi.startSession();
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
