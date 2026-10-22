import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import { createMainRuntime } from "../../src/main-runtime.js";
import { loadSettings } from "../../src/settings.js";
import { createTempDb } from "../helpers/temp-db.js";
import { buildAgentArgs } from "../../src/agents/launch.js";
import { buildRunEnvironment, captureLaunchContext, type LaunchSource } from "../../src/tools/run-environment.js";

test("captures authenticated catalog capability and conservative pricing metadata without credentials", () => {
  const temp = createTempDb();
  try {
    const model: Model<"anthropic-messages"> = {
      id: "fixture",
      name: "Fixture",
      provider: "anthropic",
      api: "anthropic-messages",
      baseUrl: "https://fixture.invalid",
      reasoning: true,
      input: ["text"],
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.2 },
      contextWindow: 1000,
      maxTokens: 100,
    };
    const zeroPriced = { ...model, id: "unpriced", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const runtime = createMainRuntime({
      cwd: temp.cwd,
      extensionPath: "/extension.ts",
      createHost: () => ({
        start: () => {},
        ensure: async () => "",
        boardUrl: () => null,
        stop: async () => {},
        releaseSync: () => {},
      }),
    });
    const env = buildRunEnvironment(runtime, temp.db, loadSettings(temp.cwd).settings, {
      model,
      thinkingLevel: "high",
      isProjectTrusted: () => true,
      modelRegistry: { getAvailable: () => [model, zeroPriced] },
    });
    assert.deepEqual(env.availableModels, [
      { provider: model.provider, id: model.id, thinkingLevels: getSupportedThinkingLevels(model), pricingKnown: true },
      {
        provider: model.provider,
        id: "unpriced",
        thinkingLevels: getSupportedThinkingLevels(model),
        pricingKnown: false,
      },
    ]);
    assert.deepEqual(env.launch.model, { provider: model.provider, modelId: model.id, thinkingLevel: "high" });
    assert.equal(JSON.stringify(env.availableModels).includes("apiKey"), false);
  } finally {
    temp.cleanup();
  }
});

const extension = "/checkout/pi-free-swarm/index.ts";
const limits = "npm:oira666_pi-limits-wait";
const ctx: LaunchSource = { model: undefined, thinkingLevel: undefined, isProjectTrusted: () => true };

for (const flag of ["-ne", "--no-extensions"]) {
  test(`captureLaunchContext forwards ${flag} while retaining explicit checkout and package extensions`, () => {
    const context = captureLaunchContext(ctx, extension, ["node", "pi", flag, "-e", extension, "-e", limits]);
    assert.deepEqual(context, {
      extensionArgs: [extension, limits],
      noExtensions: true,
      projectTrusted: true,
      model: null,
    });
    const child = parseArgs(
      buildAgentArgs({
        name: "Maria",
        cwd: "/project",
        sessionFile: "/session.jsonl",
        systemPromptFile: "/prompt.md",
        context,
        env: {},
      }),
    );
    assert.equal(child.noExtensions, true);
    assert.deepEqual(child.extensions, [extension, limits]);
    assert.equal(child.mode, "rpc");
    assert.equal(child.projectTrustOverride, true);
  });
}

test("captureLaunchContext preserves default behavior and does not forward other resource restrictions", () => {
  for (const argv of [
    ["node", "pi"],
    ["node", "pi", "-ns", "-np", "--no-themes", "-nc"],
    ["node", "pi", "--", "-ne"],
    ["node", "pi", "--append-system-prompt", "--no-extensions"],
  ]) {
    const context = captureLaunchContext(ctx, extension, argv);
    assert.deepEqual(context, { extensionArgs: [extension], projectTrusted: true, model: null });
  }
});

test("captureLaunchContext reads process argv by default and keeps the captured policy for later spawns", () => {
  const argv = process.argv;
  try {
    process.argv = ["node", "pi", "-ne", "-e", limits];
    const context = captureLaunchContext(ctx, extension);
    const spec = {
      name: "Maria",
      cwd: "/project",
      sessionFile: "/session.jsonl",
      systemPromptFile: "/prompt.md",
      context,
      env: {},
    };
    const initialArgs = buildAgentArgs(spec);
    process.argv = ["node", "pi"];
    assert.equal(context.noExtensions, true);
    assert.ok(initialArgs.includes("--no-extensions"));
    assert.deepEqual(buildAgentArgs(spec), initialArgs);
    assert.equal(captureLaunchContext(ctx, extension).noExtensions, undefined);
  } finally {
    process.argv = argv;
  }
});
