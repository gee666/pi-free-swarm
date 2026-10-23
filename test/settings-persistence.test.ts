import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { globalSettingsFile, projectSettingsFile } from "../src/settings-files.js";
import { loadSettings } from "../src/settings.js";
import { saveSessionSettings, settingsForDisplay } from "../src/settings-persistence.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  mkdirSync("tmp", { recursive: true });
  const cwd = mkdtempSync(path.resolve("tmp/settings-save-"));
  directories.push(cwd);
  const globalFile = path.join(cwd, "global", "swarm", "settings.json");
  const projectFile = projectSettingsFile(cwd);
  const put = (file: string, value: unknown) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  };
  return { cwd, globalFile, projectFile, put, load: () => loadSettings(cwd, { globalFile }).settings };
}

test("global agent-directory resolution honors the override and pi home default without writing either", () => {
  assert.equal(globalSettingsFile({}), path.join(homedir(), ".pi", "agent", "swarm", "settings.json"));
  assert.equal(
    globalSettingsFile({ PI_CODING_AGENT_DIR: "tmp/custom-agent" }),
    path.resolve("tmp/custom-agent/swarm/settings.json"),
  );
  assert.equal(
    globalSettingsFile({ PI_CODING_AGENT_DIR: "~/custom-agent" }),
    path.join(homedir(), "custom-agent/swarm/settings.json"),
  );
});

test("global defaults load before project per-key overrides, including scoped env merging", () => {
  const f = fixture();
  f.put(f.globalFile, { maxAgents: 12, staggerSeconds: 7, env: { SHARED: "global", GLOBAL_ONLY: "kept" } });
  f.put(f.projectFile, { maxAgents: 15, env: { SHARED: "project", PROJECT_ONLY: "kept" } });
  const settings = f.load();
  assert.equal(settings.maxAgents, 15);
  assert.equal(settings.staggerSeconds, 7);
  assert.deepEqual(settings.env, { SHARED: "project", GLOBAL_ONLY: "kept", PROJECT_ONLY: "kept" });
  assert.equal(loadSettings(f.cwd, { globalFile: null }).settings.staggerSeconds, 30);
});

test("project save persists a session max override, leaves global untouched and preserves destination env", () => {
  const f = fixture();
  f.put(f.globalFile, { maxAgents: 12 });
  f.put(f.projectFile, { maxAgents: 15, env: { TARGET_SECRET: "destination-owned" }, futureSetting: 3 });
  const settings = { ...f.load(), maxAgents: 20, env: { ACTIVE_SECRET: "never-copy" } };
  assert.equal(saveSessionSettings(f.cwd, settings, "project", { globalFile: f.globalFile }), f.projectFile);
  const saved = readFileSync(f.projectFile, "utf8");
  assert.ok(saved.includes("destination-owned"));
  assert.ok(saved.includes('"futureSetting": 3'));
  assert.ok(!saved.includes("never-copy"));
  assert.ok(!saved.includes("enabled"));
  assert.equal(f.load().maxAgents, 20);
  assert.equal(readFileSync(f.globalFile, "utf8"), '{"maxAgents":12}');
});

test("global save does not copy project secrets and is inherited by a fresh project", () => {
  const f = fixture();
  f.put(f.globalFile, { env: { GLOBAL_SECRET: "global-owned" } });
  f.put(f.projectFile, { maxAgents: 15, env: { PROJECT_SECRET: "never-global" } });
  const settings = { ...f.load(), maxAgents: 22 };
  assert.equal(saveSessionSettings(f.cwd, settings, "global", { globalFile: f.globalFile }), f.globalFile);
  const saved = readFileSync(f.globalFile, "utf8");
  assert.ok(saved.includes("global-owned"));
  assert.ok(!saved.includes("PROJECT_SECRET"));
  assert.ok(!saved.includes("never-global"));
  const other = path.join(f.cwd, "other-project");
  assert.equal(loadSettings(other, { globalFile: f.globalFile }).settings.maxAgents, 22);
  assert.equal(f.load().maxAgents, 15, "existing project override still wins");
});

test("saving unlimited values removes old optional ceilings rather than resurrecting them", () => {
  const f = fixture();
  const settings = f.load();
  f.put(f.projectFile, {
    budgetMoneyUsd: 2,
    budgetTimeSeconds: 60,
    port: 3999,
    models: [{ provider: "p", model: "m", thinkingLevel: "off" }],
  });
  saveSessionSettings(f.cwd, settings, "project", { globalFile: f.globalFile });
  assert.equal(f.load().budgetMoneyUsd, undefined);
  assert.equal(f.load().budgetTimeSeconds, undefined);
  assert.equal(f.load().port, null);
  assert.equal(f.load().models, undefined);
});

test("display redacts env values and malformed destination refuses save without truncating it", () => {
  const f = fixture();
  const settings = { ...f.load(), env: { API_KEY: "private-value" } };
  const display = JSON.stringify(settingsForDisplay(settings));
  assert.ok(display.includes("API_KEY=<redacted>"));
  assert.ok(!display.includes("private-value"));
  mkdirSync(path.dirname(f.projectFile), { recursive: true });
  const invalid = '{"env":{"API_KEY":"private-value"},';
  writeFileSync(f.projectFile, invalid);
  assert.throws(
    () => saveSessionSettings(f.cwd, settings, "project", { globalFile: f.globalFile }),
    (error: unknown) => error instanceof Error && !error.message.includes("private-value"),
  );
  assert.equal(readFileSync(f.projectFile, "utf8"), invalid);
});

test("invalid explicit target is rejected without writing a global file", () => {
  const f = fixture();
  assert.throws(
    () => Reflect.apply(saveSessionSettings, undefined, [f.cwd, f.load(), "elsewhere", { globalFile: f.globalFile }]),
    /target must be project or global/,
  );
  assert.equal(f.load().maxAgents, 10);
});
