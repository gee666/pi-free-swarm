import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, it } from "node:test";
import piFreeSwarm from "../index.js";
import { ENABLED_ENV, MAIN_TOOL, ROLE_ENV } from "../src/constants.js";
import { createMainRuntime, type BoardHost } from "../src/main-runtime.js";
import { createMainToolHandlers } from "../src/tools/main-tools.js";
import { swarmDbPath } from "../src/store/db.js";
import { registerRun, stopOwnedRuns, unregisterRun } from "../src/broker/run-registry.js";
import { FakeExtensionApi } from "./helpers/fake-extension-api.js";

mkdirSync("tmp", { recursive: true });
const root = mkdtempSync(path.resolve("tmp/session-runtime-"));
const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
after(() => {
  if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
  rmSync(root, { recursive: true, force: true });
});
let projectId = 0;
function project() {
  const cwd = path.join(root, String(++projectId));
  mkdirSync(path.join(cwd, ".pi/swarm"), { recursive: true });
  writeFileSync(path.join(cwd, ".pi/swarm/settings.json"), '{"minAgents":3,"maxAgents":15,"defaultAgents":8}');
  return cwd;
}

async function mainSession(run: (pi: FakeExtensionApi, cwd: string) => Promise<void>) {
  const previousRole = process.env[ROLE_ENV];
  const previousEnabled = process.env[ENABLED_ENV];
  delete process.env[ROLE_ENV];
  delete process.env[ENABLED_ENV];
  const pi = new FakeExtensionApi();
  const cwd = project();
  try {
    piFreeSwarm(pi);
    pi.startSession(cwd);
    await run(pi, cwd);
  } finally {
    await pi.shutdownSession();
    if (previousRole === undefined) delete process.env[ROLE_ENV];
    else process.env[ROLE_ENV] = previousRole;
    if (previousEnabled === undefined) delete process.env[ENABLED_ENV];
    else process.env[ENABLED_ENV] = previousEnabled;
  }
}

it("enables without CLI opt-in and disables only swarm tools, preserving unrelated tools", async () => {
  await mainSession(async (pi, cwd) => {
    assert.deepEqual(pi.toolNames(), []);
    assert.equal(pi.commands.size, 5);
    pi.setActiveTools(["read", "bash"]);
    await pi.command("swarm:enable", "", cwd);
    assert.deepEqual(pi.toolNames(), Object.values(MAIN_TOOL));
    assert.deepEqual(pi.getActiveTools(), ["read", "bash", ...Object.values(MAIN_TOOL)]);
    await pi.command("swarm:disable", "", cwd);
    assert.deepEqual(pi.getActiveTools(), ["read", "bash"]);
    await pi.command("swarm:enable", "", cwd);
    assert.deepEqual(pi.toolNames(), Object.values(MAIN_TOOL));
    assert.deepEqual(pi.getActiveTools(), ["read", "bash", ...Object.values(MAIN_TOOL)]);
    assert.equal(existsSync(swarmDbPath(cwd)), false);
  });
});

it("refreshes advertised creation limits without reactivating disabled tools", async () => {
  await mainSession(async (pi, cwd) => {
    await pi.command("swarm:enable", "", cwd);
    await pi.command("swarm:disable", "", cwd);
    await pi.command("swarm:max-agents", "5", cwd);
    assert.match(pi.tool(MAIN_TOOL.swarm).description, /3–5, default 5/);
    assert.deepEqual(pi.getActiveTools(), []);
    await pi.command("swarm:settings", "", cwd);
    assert.match(pi.notes.at(-1) ?? "", /"maxAgents": 5/);
    await pi.shutdownSession();
    await pi.command("swarm:settings", "", cwd);
    assert.match(pi.notes.at(-1) ?? "", /"maxAgents": 15/);
    assert.match(pi.notes.at(-1) ?? "", /"enabled": false/);
  });
});

const params = {
  swarm_name: "test",
  task_prompt: "do work",
  acceptance_criteria: ["Artifact verified."],
  agent_amount: 3,
};
const ctx = { model: undefined, thinkingLevel: undefined, isProjectTrusted: () => true };
function runtimeWith(host: BoardHost) {
  return createMainRuntime({ cwd: project(), extensionPath: "/fixture/index.ts", createHost: () => host });
}
function host(): BoardHost {
  return {
    start: () => {},
    ensure: async () => null,
    boardUrl: () => null,
    stop: async () => {},
    releaseSync: () => {},
  };
}

it("blocks stale Main tool execution while disabled before creating any database", async () => {
  const runtime = runtimeWith(host());
  runtime.session = { enabled: false };
  const handlers = createMainToolHandlers(runtime);
  await assert.rejects(handlers.swarm(params, undefined, undefined, ctx), /disabled for this session/);
  await assert.rejects(
    handlers.resume({ swarm_id: 1, message: "Resume saved work." }, undefined, undefined, ctx),
    /disabled for this session/,
  );
  assert.equal(existsSync(swarmDbPath(runtime.cwd)), false);
  runtime.closeDb();
});

it("revalidates disable after an awaited board acquisition before launch", async () => {
  let finish = () => {};
  let entered = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const acquiring = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const board = host();
  board.ensure = async () => {
    entered();
    await acquiring;
    return null;
  };
  const runtime = runtimeWith(board);
  runtime.session = { enabled: true };
  const running = createMainToolHandlers(runtime).swarm(params, undefined, undefined, ctx);
  await started;
  runtime.session.enabled = false;
  finish();
  await assert.rejects(running, /disabled for this session/);
  runtime.closeDb();
});

it("joins only the disabled session's owned runs and leaves unrelated sessions alive", async () => {
  const owner = {};
  const unrelated = {};
  const stopped: string[] = [];
  let release = () => {};
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mine = {
    stop: async () => {
      stopped.push("mine");
      await cleanup;
    },
  };
  const theirs = {
    stop: async () => {
      stopped.push("theirs");
    },
  };
  const unowned = {
    stop: async () => {
      stopped.push("unowned");
    },
  };
  registerRun(mine, owner);
  registerRun(theirs, unrelated);
  registerRun(unowned);
  try {
    let joined = false;
    const stopping = stopOwnedRuns(owner).then(() => {
      joined = true;
    });
    await Promise.resolve();
    assert.deepEqual(stopped, ["mine"]);
    assert.equal(joined, false);
    release();
    await stopping;
    assert.equal(joined, true);
    assert.deepEqual(stopped, ["mine"]);
  } finally {
    release();
    unregisterRun(mine);
    unregisterRun(theirs);
    unregisterRun(unowned);
  }
});

it("enforces overridden creation maximum without mutating the file-configured limit", async () => {
  const runtime = runtimeWith(host());
  runtime.session = { enabled: true, maxAgents: 5 };
  await assert.rejects(
    createMainToolHandlers(runtime).swarm({ ...params, agent_amount: 6 }, undefined, undefined, ctx),
    /between 3 and 5/,
  );
  assert.equal(existsSync(swarmDbPath(runtime.cwd)), false);
  runtime.closeDb();
});
