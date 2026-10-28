import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { applySessionOptions, registerSessionCommands, type SessionCommands } from "../src/session-commands.js";
import { loadSettings } from "../src/settings.js";
import { FakeExtensionApi } from "./helpers/fake-extension-api.js";

mkdirSync("tmp", { recursive: true });
const cwd = mkdtempSync(path.resolve("tmp/session-commands-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = path.join(cwd, "agent");
after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(cwd, { recursive: true, force: true });
});

function fixture() {
  const pi = new FakeExtensionApi();
  const events: string[] = [];
  const controls: SessionCommands = {
    options: { enabled: false },
    enable: () => {
      controls.options.enabled = true;
      events.push("enable");
    },
    disable: async () => {
      controls.options.enabled = false;
      events.push("disable");
    },
  };
  registerSessionCommands(pi, controls);
  return { pi, controls, events };
}

describe("session swarm commands", () => {
  it("registers the five requested commands without enabling anything", () => {
    const { pi, controls } = fixture();
    assert.deepEqual(
      [...pi.commands.keys()],
      ["swarm:enable", "swarm:disable", "swarm:max-agents", "swarm:settings", "swarm:save-settings"],
    );
    assert.equal(controls.options.enabled, false);
    assert.deepEqual(pi.toolNames(), []);
  });

  it("enables and disables through serialized callbacks", async () => {
    const { pi, controls, events } = fixture();
    await pi.command("swarm:enable", "", cwd);
    assert.equal(controls.options.enabled, true);
    await pi.command("swarm:disable", "", cwd);
    assert.equal(controls.options.enabled, false);
    assert.deepEqual(events, ["enable", "disable"]);
    assert.ok(pi.notes.some((note) => note.includes("Pending communication is preserved")));
  });

  it("awaits activation before reporting success and recovers after import failure", async () => {
    const { pi, controls } = fixture();
    let release = () => {};
    const loading = new Promise<void>((resolve) => {
      release = resolve;
    });
    controls.enable = () => loading;
    const enabling = pi.command("swarm:enable", "", cwd);
    await Promise.resolve();
    assert.deepEqual(pi.notes, []);
    release();
    await enabling;
    assert.equal(pi.notes.at(-1), "Swarm enabled for this session.");
    controls.enable = async () => {
      throw new Error("import failed");
    };
    await pi.command("swarm:enable", "", cwd);
    assert.equal(pi.notes.at(-1), "import failed");
    controls.enable = () => {};
    await pi.command("swarm:enable", "", cwd);
    assert.equal(pi.notes.at(-1), "Swarm enabled for this session.");
  });

  it("does not notify a stale context when shutdown interrupts activation", async () => {
    const { pi, controls } = fixture();
    let release = () => {};
    controls.enable = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const enabling = pi.command("swarm:enable", "", cwd);
    await Promise.resolve();
    await pi.shutdownSession();
    release();
    await enabling;
    assert.deepEqual(pi.notes, []);
    assert.equal(controls.options.enabled, false);
  });

  it("waits for joined disable cleanup before admitting a following enable", async () => {
    const { pi, controls, events } = fixture();
    let release = () => {};
    const cleanup = new Promise<void>((resolve) => {
      release = resolve;
    });
    controls.disable = async () => {
      events.push("cleanup-start");
      await cleanup;
      events.push("cleanup-end");
    };
    const disabling = pi.command("swarm:disable", "", cwd);
    const enabling = pi.command("swarm:enable", "", cwd);
    await Promise.resolve();
    assert.equal(events.includes("enable"), false);
    release();
    await Promise.all([disabling, enabling]);
    assert.deepEqual(events, ["cleanup-start", "cleanup-end", "enable"]);
  });

  it("rejects malformed maxima without changing the current override", async () => {
    const { pi, controls } = fixture();
    controls.options.maxAgents = 15;
    for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "2 extra", "9007199254740992"]) {
      await pi.command("swarm:max-agents", value, cwd);
      assert.equal(controls.options.maxAgents, 15, value);
      assert.match(pi.notes.at(-1) ?? "", /positive integer/);
    }
  });

  it("keeps positive maximum changes in memory and leaves settings unchanged", async () => {
    const settingsDir = path.join(cwd, ".pi/swarm");
    mkdirSync(settingsDir, { recursive: true });
    const settingsFile = path.join(settingsDir, "settings.json");
    const source = '{"minAgents":3,"maxAgents":15,"defaultAgents":8}\n';
    writeFileSync(settingsFile, source);
    const { pi, controls } = fixture();
    await pi.command("swarm:max-agents", " 5 ", cwd);
    assert.equal(controls.options.maxAgents, 5);
    assert.equal(readFileSync(settingsFile, "utf8"), source);
    await pi.command("swarm:max-agents", "2", cwd);
    assert.equal(controls.options.maxAgents, 5);
    assert.match(pi.notes.at(-1) ?? "", /minAgents \(3\)/);
    const next = fixture();
    assert.equal(next.controls.options.maxAgents, undefined);
    assert.equal(next.controls.options.enabled, false);
  });

  it("resets overrides and fences queued old-session work during shutdown", async () => {
    const { pi, controls, events } = fixture();
    let release = () => {};
    const cleanup = new Promise<void>((resolve) => {
      release = resolve;
    });
    controls.disable = async () => {
      await cleanup;
      events.push("cleanup-end");
    };
    controls.options.maxAgents = 5;
    const disabling = pi.command("swarm:disable", "", cwd);
    const enabling = pi.command("swarm:enable", "", cwd);
    await Promise.resolve();
    await pi.shutdownSession();
    release();
    await Promise.all([disabling, enabling]);
    assert.equal(controls.options.maxAgents, undefined);
    assert.equal(controls.options.enabled, false);
    assert.equal(events.includes("enable"), false);
  });

  it("does not let an old unresolved save picker block commands in the replacement session", async () => {
    const { pi, events } = fixture();
    const settingsFile = path.join(cwd, ".pi/swarm/settings.json");
    const before = readFileSync(settingsFile, "utf8");
    let release = () => {};
    pi.selectionResult = new Promise<string | undefined>((resolve) => {
      release = () => resolve("project");
    });
    const choosing = pi.command("swarm:save-settings", "", cwd);
    await Promise.resolve();
    assert.equal(pi.selectRequests.length, 1);
    await pi.shutdownSession();
    pi.selectionResult = undefined;
    const enabling = pi.command("swarm:enable", "", cwd);
    try {
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(events.includes("enable"), true);
    } finally {
      release();
      await Promise.all([choosing, enabling]);
    }
    assert.equal(readFileSync(settingsFile, "utf8"), before);
  });

  it("applies session maxima to future creation settings without mutating file settings", () => {
    const original = loadSettings(cwd).settings;
    const effective = applySessionOptions(original, { enabled: true, maxAgents: 5 });
    assert.equal(effective.maxAgents, 5);
    assert.equal(effective.defaultAgents, 5);
    assert.equal(original.maxAgents, 15);
    assert.equal(original.defaultAgents, 8);
  });

  it("shows effective settings while redacting environment values", async () => {
    const { pi, controls } = fixture();
    const settingsFile = path.join(cwd, ".pi/swarm/settings.json");
    writeFileSync(settingsFile, '{"minAgents":3,"maxAgents":15,"env":{"SECRET_TOKEN":"do-not-display"}}');
    controls.options.maxAgents = 5;
    await pi.command("swarm:settings", "", cwd);
    const displayed = pi.notes.at(-1) ?? "";
    assert.match(displayed, /"maxAgents": 5/);
    assert.match(displayed, /SECRET_TOKEN=<redacted>/);
    assert.equal(displayed.includes("do-not-display"), false);
    assert.equal(displayed.includes('"enabled": false'), true);
  });

  it("requires an explicit save scope or an interactive choice and preserves cancellation", async () => {
    const { pi, controls } = fixture();
    controls.options.maxAgents = 5;
    const settingsFile = path.join(cwd, ".pi/swarm/settings.json");
    const before = readFileSync(settingsFile, "utf8");
    await pi.command("swarm:save-settings", "", cwd);
    assert.deepEqual(pi.selectRequests.at(-1), ["project", "global"]);
    assert.equal(readFileSync(settingsFile, "utf8"), before);
    await pi.command("swarm:save-settings", "elsewhere", cwd);
    assert.match(pi.notes.at(-1) ?? "", /project\|global/);
    await pi.command("swarm:save-settings", "", cwd, false);
    assert.match(pi.notes.at(-1) ?? "", /project\|global/);
    pi.selection = "project";
    await pi.command("swarm:save-settings", "", cwd);
    const saved: Record<string, unknown> = JSON.parse(readFileSync(settingsFile, "utf8"));
    assert.equal(saved.maxAgents, 5);
    assert.equal(saved.enabled, undefined);
    assert.deepEqual(saved.env, { SECRET_TOKEN: "do-not-display" });
    await pi.command("swarm:save-settings", "global", cwd);
    const globalFile = path.join(cwd, "agent/swarm/settings.json");
    const globalSaved: Record<string, unknown> = JSON.parse(readFileSync(globalFile, "utf8"));
    assert.equal(globalSaved.maxAgents, 5);
    assert.equal(globalSaved.env, undefined);
    assert.equal(globalSaved.enabled, undefined);
  });

  it("rejects arguments on toggles and keeps later commands usable after a failure", async () => {
    const { pi, controls, events } = fixture();
    await pi.command("swarm:enable", "extra", cwd);
    await pi.command("swarm:disable", "extra", cwd);
    assert.deepEqual(events, []);
    controls.disable = async () => {
      throw new Error("cleanup failed visibly");
    };
    await pi.command("swarm:disable", "", cwd);
    assert.equal(pi.notes.at(-1), "cleanup failed visibly");
    await pi.command("swarm:enable", "", cwd);
    assert.equal(controls.options.enabled, true);
  });
});
