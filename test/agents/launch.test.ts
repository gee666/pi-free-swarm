import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  buildAgentArgs,
  buildChildProcessEnv,
  forwardedExtensionArgs,
  getPiCommand,
  hasSessionFile,
  type AgentLaunchSpec,
} from "../../src/agents/launch.js";

const spec: AgentLaunchSpec = {
  name: "Maria",
  cwd: "/project",
  sessionFile: "/project/.pi/swarm/sessions/3/Maria/session.jsonl",
  systemPromptFile: "/project/.pi/swarm/sessions/3/Maria/system-prompt.md",
  context: {
    extensionArgs: ["/ext/pi-free-swarm/index.ts", "/ext/other.ts"],
    projectTrusted: true,
    model: { provider: "anthropic", modelId: "claude-haiku-4-5", thinkingLevel: "low" },
  },
  env: {},
};

test("agent args: rpc mode, fixed session file, prompt file, -e per extension, trust and model", () => {
  assert.deepEqual(buildAgentArgs(spec), [
    "--mode",
    "rpc",
    "--session",
    spec.sessionFile,
    "--append-system-prompt",
    spec.systemPromptFile,
    "-e",
    "/ext/pi-free-swarm/index.ts",
    "-e",
    "/ext/other.ts",
    "--approve",
    "--model",
    "anthropic/claude-haiku-4-5",
    "--thinking",
    "low",
  ]);
  const untrusted = buildAgentArgs({ ...spec, context: { extensionArgs: [], projectTrusted: false, model: null } });
  assert.ok(untrusted.includes("--no-approve"));
  for (const args of [buildAgentArgs(spec), untrusted]) {
    for (const forbidden of ["-ne", "--no-extensions", "--continue", "--session-dir"]) {
      assert.ok(!args.includes(forbidden), forbidden);
    }
  }
});

test("forwardedExtensionArgs reads both flag forms, resolves paths and keeps package sources", () => {
  const argv = [
    "node",
    "pi",
    "-e",
    "./a.ts",
    "--extension=b",
    "--model",
    "x",
    "-e",
    "npm:@x/y",
    "--extension",
    "git:g/h",
  ];
  assert.deepEqual(forwardedExtensionArgs(argv, "/work"), ["/work/a.ts", "/work/b", "npm:@x/y", "git:g/h"]);
  assert.deepEqual(forwardedExtensionArgs(["node", "pi", "-e"], "/work"), []);
});

test("getPiCommand: env override with JSON prefix, else this node and entrypoint", () => {
  assert.deepEqual(getPiCommand({ PI_SWARM_PI_COMMAND: "/bin/fake", PI_SWARM_PI_ARGS_PREFIX: '["a","b"]' }), {
    command: "/bin/fake",
    argsPrefix: ["a", "b"],
  });
  assert.throws(() => getPiCommand({ PI_SWARM_PI_COMMAND: "x", PI_SWARM_PI_ARGS_PREFIX: '"a"' }), /JSON array/);
  const own = getPiCommand({});
  assert.equal(own.command, process.execPath);
  assert.deepEqual(own.argsPrefix, [path.resolve(process.argv[1])]);
});

test("child env adds the extra vars and keeps node on PATH", () => {
  const env = buildChildProcessEnv({ PI_SWARM_AGENT: "Maria" });
  assert.equal(env.PI_SWARM_AGENT, "Maria");
  assert.ok(env.PATH?.split(path.delimiter).includes(path.dirname(process.execPath)));
});

test("hasSessionFile is false for missing and empty files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-launch-"));
  try {
    const file = path.join(dir, "session.jsonl");
    assert.equal(hasSessionFile(file), false);
    fs.writeFileSync(file, "");
    assert.equal(hasSessionFile(file), false);
    fs.writeFileSync(file, "{}\n");
    assert.equal(hasSessionFile(file), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
