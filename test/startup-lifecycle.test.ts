import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { after, it } from "node:test";
import piFreeSwarm from "../index.js";
import { ENABLED_ENV, ENABLE_FLAG, MAIN_TOOL, ROLE_ENV } from "../src/constants.js";
import { FakeExtensionApi } from "./helpers/fake-extension-api.js";

mkdirSync("tmp", { recursive: true });
const cwd = mkdtempSync(path.resolve("tmp/startup-lifecycle-"));
const saved = { [ROLE_ENV]: process.env[ROLE_ENV], [ENABLED_ENV]: process.env[ENABLED_ENV] };
delete process.env[ROLE_ENV];
delete process.env[ENABLED_ENV];
after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(cwd, { recursive: true, force: true });
});

async function enabledApi() {
  const pi = new FakeExtensionApi();
  await piFreeSwarm(pi);
  pi.flagValues.set(ENABLE_FLAG, true);
  return pi;
}

it("shutdown during lazy import prevents stale runtime and tool registration", async () => {
  const pi = await enabledApi();
  const starting = pi.startSession(cwd);
  await pi.shutdownSession();
  await starting;
  assert.deepEqual(pi.toolNames(), []);
  assert.deepEqual(pi.getActiveTools(), []);
});

it("a replacement session can activate while an older import is still pending", async () => {
  const pi = await enabledApi();
  const original = pi.startSession(cwd);
  await pi.shutdownSession();
  const replacement = pi.startSession(cwd);
  try {
    await Promise.all([original, replacement]);
    assert.deepEqual(pi.toolNames(), Object.values(MAIN_TOOL));
    assert.deepEqual(pi.getActiveTools(), Object.values(MAIN_TOOL));
  } finally {
    await pi.shutdownSession();
  }
});

it("concurrent session starts share activation and preserve unrelated tools", async () => {
  class ObservedApi extends FakeExtensionApi {
    activations = 0;
    override setActiveTools(names: string[]) {
      this.activations++;
      super.setActiveTools(names);
    }
  }
  const pi = new ObservedApi();
  await piFreeSwarm(pi);
  pi.flagValues.set(ENABLE_FLAG, true);
  pi.setActiveTools(["read"]);
  const before = pi.activations;
  try {
    await Promise.all([pi.startSession(cwd), pi.startSession(cwd)]);
    assert.equal(pi.activations, before + 1);
    assert.deepEqual(pi.getActiveTools(), ["read", ...Object.values(MAIN_TOOL)]);
  } finally {
    await pi.shutdownSession();
  }
});
