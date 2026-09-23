import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  buildAgentEnv,
  describeAgentRange,
  describeEnvKeys,
  loadSettings,
  resolveAgentAmount,
  resolvePort,
  SettingsError,
} from "../src/settings.js";

const dirs: string[] = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function project(content?: string): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-free-swarm-settings-"));
  dirs.push(cwd);
  if (content !== undefined) {
    mkdirSync(path.join(cwd, ".pi/swarm"), { recursive: true });
    writeFileSync(path.join(cwd, ".pi/swarm/settings.json"), content);
  }
  return cwd;
}

function loadError(content: string): string {
  try {
    loadSettings(project(content));
  } catch (error) {
    assert.ok(error instanceof SettingsError);
    return error.message;
  }
  assert.fail("expected a SettingsError");
}

describe("loadSettings", () => {
  it("uses the defaults without a file", () => {
    const { settings, warnings } = loadSettings(project());
    assert.deepEqual(settings, {
      port: null,
      minAgents: 1,
      maxAgents: 10,
      defaultAgents: 5,
      staggerSeconds: 20,
      env: {},
    });
    assert.deepEqual(warnings, []);
  });

  it("reads every key and clamps defaultAgents into the range", () => {
    const { settings } = loadSettings(
      project(JSON.stringify({ port: 4000, minAgents: 2, maxAgents: 3, defaultAgents: 5, staggerSeconds: 0.5 })),
    );
    assert.equal(settings.port, 4000);
    assert.equal(settings.defaultAgents, 3);
    assert.equal(settings.staggerSeconds, 0.5);
    assert.equal(loadSettings(project('{"minAgents": 4, "defaultAgents": 1}')).settings.defaultAgents, 4);
  });

  it("rejects invalid JSON without echoing the file content", () => {
    const message = loadError('{"env": {"TOKEN": s3cr3t-value}}');
    assert.match(message, /^settings\.json: invalid JSON \(/);
    assert.doesNotMatch(message, /s3cr3t/);
    assert.match(loadError('{"port": 1,'), /^settings\.json: invalid JSON \(.+\)$/);
  });

  it("rejects wrong types naming the key and the reason", () => {
    assert.equal(loadError("[]"), "settings.json: must be a JSON object");
    assert.equal(loadError('{"port": "abc"}'), 'settings.json: port must be an integer 1–65535 (got "abc")');
    assert.equal(loadError('{"port": 70000}'), "settings.json: port must be an integer 1–65535 (got 70000)");
    assert.equal(loadError('{"minAgents": 0}'), "settings.json: minAgents must be an integer >= 1 (got 0)");
    assert.equal(loadError('{"defaultAgents": 2.5}'), "settings.json: defaultAgents must be an integer (got 2.5)");
    assert.equal(loadError('{"staggerSeconds": -1}'), "settings.json: staggerSeconds must be a number >= 0 (got -1)");
    assert.equal(loadError('{"env": ["A"]}'), "settings.json: env must be an object of string values");
  });

  it("never includes env values in env errors", () => {
    const message = loadError('{"env": {"FOO": 12345678}}');
    assert.equal(message, "settings.json: env.FOO must be a string");
  });

  it("rejects maxAgents below minAgents", () => {
    assert.equal(
      loadError('{"minAgents": 4, "maxAgents": 3}'),
      "settings.json: maxAgents (3) must be >= minAgents (4)",
    );
  });

  it("warns about unknown keys and reserved env keys, and drops the latter", () => {
    const { settings, warnings } = loadSettings(
      project(JSON.stringify({ foo: 1, env: { NODE_ENV: "dev", PI_SWARM_DB: "/evil.db" } })),
    );
    assert.deepEqual(settings.env, { NODE_ENV: "dev" });
    assert.deepEqual(warnings, [
      'settings.json: unknown key "foo" ignored',
      "settings.json: env.PI_SWARM_DB ignored (reserved prefix)",
    ]);
    assert.ok(warnings.every((warning) => !warning.includes("/evil.db")));
  });

  it("reads the file fresh on every call", () => {
    const cwd = project('{"maxAgents": 3}');
    assert.equal(loadSettings(cwd).settings.maxAgents, 3);
    writeFileSync(path.join(cwd, ".pi/swarm/settings.json"), '{"maxAgents": 7}');
    assert.equal(loadSettings(cwd).settings.maxAgents, 7);
  });
});

describe("agent amount", () => {
  const { settings } = loadSettings(project('{"minAgents": 2, "maxAgents": 8}'));

  it("defaults, accepts the range and never clamps", () => {
    assert.equal(resolveAgentAmount(settings, undefined), 5);
    assert.equal(resolveAgentAmount(settings, 2), 2);
    assert.equal(resolveAgentAmount(settings, 8), 8);
    assert.throws(() => resolveAgentAmount(settings, 12), {
      message: "agent_amount must be between 2 and 8 (got 12).",
    });
    assert.throws(() => resolveAgentAmount(settings, 1), { message: "agent_amount must be between 2 and 8 (got 1)." });
    assert.throws(() => resolveAgentAmount(settings, 2.5), /got 2\.5/);
  });

  it("describes the range", () => {
    assert.equal(describeAgentRange(settings), "agent_amount: 2–8, default 5");
  });
});

describe("agent env", () => {
  const { settings } = loadSettings(
    project(JSON.stringify({ env: { DATABASE_URL: "postgres://secret@db", NODE_ENV: "development" } })),
  );

  it("adds the reserved variables after settings.env", () => {
    const env = buildAgentEnv(settings, {
      dbPath: "/p/.pi/swarm/swarm.db",
      swarmId: 3,
      agentName: "Maria",
      runnerPid: 42,
    });
    assert.deepEqual(env, {
      DATABASE_URL: "postgres://secret@db",
      NODE_ENV: "development",
      PI_SWARM_ROLE: "agent",
      PI_SWARM_DB: "/p/.pi/swarm/swarm.db",
      PI_SWARM_ID: "3",
      PI_SWARM_AGENT: "Maria",
      PI_SWARM_RUNNER_PID: "42",
    });
    assert.deepEqual(Object.keys(env).slice(0, 2), ["DATABASE_URL", "NODE_ENV"]);
  });

  it("describes only the key names", () => {
    assert.equal(describeEnvKeys(settings), "env: DATABASE_URL, NODE_ENV");
    assert.equal(describeEnvKeys(loadSettings(project()).settings), "");
  });
});

describe("resolvePort", () => {
  const defaults = loadSettings(project()).settings;

  it("prefers settings, then PI_SWARM_PORT, then the fallback range", () => {
    const configured = loadSettings(project('{"port": 4000}')).settings;
    assert.deepEqual(resolvePort(configured, { PI_SWARM_PORT: "5000" }), { candidates: [4000], explicit: true });
    assert.deepEqual(resolvePort(defaults, { PI_SWARM_PORT: "5000" }), { candidates: [5000], explicit: true });
    const fallback = resolvePort(defaults, {});
    assert.equal(fallback.explicit, false);
    assert.equal(fallback.candidates[0], 3010);
    assert.equal(fallback.candidates.at(-1), 3030);
    assert.equal(fallback.candidates.length, 21);
  });

  it("rejects an invalid PI_SWARM_PORT", () => {
    assert.throws(() => resolvePort(defaults, { PI_SWARM_PORT: "abc" }), {
      message: 'PI_SWARM_PORT must be an integer 1–65535 (got "abc").',
    });
  });
});
