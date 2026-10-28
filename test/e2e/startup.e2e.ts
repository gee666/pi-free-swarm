import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";
import { MAIN_TOOL, WATCHER_TOOLS } from "../../src/constants.js";

type Snapshot = { tools: { name: string }[]; active: string[]; commands: string[] };

it(
  "latest local Pi loads source and extracted npm package with equivalent startup behavior",
  { timeout: 120_000 },
  () => {
    mkdirSync("tmp", { recursive: true });
    const root = mkdtempSync(path.resolve("tmp/startup-package-"));
    const cwd = path.join(root, "project");
    mkdirSync(cwd);
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("PI_")) delete env[key];
    env.PI_CODING_AGENT_DIR = path.join(root, "agent");
    const piCli = realpathSync("node_modules/.bin/pi");
    const probe = path.resolve("test/fixtures/startup-probe.ts");
    const run = (entry: string, args: string[] = [], identity: Record<string, string> = {}): Snapshot[] => {
      const result = spawnSync(
        process.execPath,
        [
          piCli,
          "--offline",
          "--no-session",
          "--no-extensions",
          "--no-mcp",
          "--no-skills",
          "--no-context-files",
          "--no-prompt-templates",
          "--no-themes",
          "--approve",
          "--print",
          "--model",
          "startup-probe/probe",
          "-e",
          entry,
          "-e",
          probe,
          ...args,
        ],
        { cwd, env: { ...env, ...identity }, encoding: "utf8", timeout: 20_000 },
      );
      assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stderr}\n${result.stdout}`);
      assert.doesNotMatch(result.stderr, /Extension error|Failed to load extension/);
      const snapshots = [...result.stderr.matchAll(/STARTUP_SNAPSHOT (\{[^\r\n]+\})/g)].map((match): Snapshot =>
        JSON.parse(match[1]),
      );
      assert.ok(snapshots.length > 0, "startup must finish without a provider request");
      return snapshots;
    };
    try {
      const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", root], {
        encoding: "utf8",
        timeout: 30_000,
      });
      assert.equal(pack.status, 0, pack.stderr);
      const tarball = readdirSync(root).find((name) => name.endsWith(".tgz"));
      assert.ok(tarball);
      const extraction = spawnSync("tar", ["-xzf", path.join(root, tarball), "-C", root], {
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(extraction.status, 0, extraction.stderr);
      const source = path.resolve(".");
      const packed = path.join(root, "package");
      const inactive = run(source);
      assert.equal(inactive[0].tools.length, 0);
      assert.deepEqual(run(packed), inactive);
      const enabled = run(source, ["--swarm"]);
      assert.deepEqual(enabled[0].tools.map((tool) => tool.name).sort(), Object.values(MAIN_TOOL).sort());
      assert.deepEqual(run(packed, ["--swarm"]), enabled);
      assert.deepEqual(run(packed, [], { PI_SWARM_ENABLED: "1" }), enabled);
      const commands = ["/swarm:enable", "/startup-snapshot", "/swarm:disable", "/startup-snapshot"];
      const sourceCommands = run(source, commands);
      assert.equal(sourceCommands.length, 3);
      assert.deepEqual(sourceCommands[1], enabled[0]);
      assert.ok(Object.values(MAIN_TOOL).every((name) => !sourceCommands[2].active.includes(name)));
      assert.deepEqual(run(packed, commands), sourceCommands);
      const identity = {
        PI_SWARM_ROLE: "agent",
        PI_SWARM_AGENT: "Watcher",
        PI_SWARM_DB: path.join(root, "unused.db"),
        PI_SWARM_ID: "1",
        PI_SWARM_RUN: "1",
        PI_SWARM_RUNNER_PID: String(process.pid),
      };
      const agent = run(source, [], identity);
      assert.deepEqual(agent[0].tools.map((tool) => tool.name).sort(), [...WATCHER_TOOLS].sort());
      assert.deepEqual(run(packed, [], identity), agent);
      console.log(
        `Startup package equivalence verified against ${spawnSync(process.execPath, [piCli, "--version"], { encoding: "utf8", timeout: 10_000 }).stdout.trim()}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
