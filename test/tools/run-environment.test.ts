import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "@earendil-works/pi-coding-agent";
import { buildAgentArgs } from "../../src/agents/launch.js";
import { captureLaunchContext, type LaunchSource } from "../../src/tools/run-environment.js";

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
