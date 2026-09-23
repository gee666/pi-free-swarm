// Launching agents against test/fixtures/fake-pi.ts: env, temp dirs, logs and named scenarios.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PI_ARGS_PREFIX_ENV, PI_COMMAND_ENV } from "../../../src/constants.js";
import type { AgentLaunchSpec } from "../../../src/agents/launch.js";
import type { FakePiScenario } from "../fake-pi.js";

export type { FakePiScenario, FakeStep } from "../fake-pi.js";

export const FAKE_PI_PATH = fileURLToPath(new URL("../fake-pi.ts", import.meta.url));

/** Node runs the fake with type stripping, so it works from any cwd and without a loader. */
export function fakePiCommandEnv(): Record<string, string> {
  return { [PI_COMMAND_ENV]: process.execPath, [PI_ARGS_PREFIX_ENV]: JSON.stringify([FAKE_PI_PATH]) };
}

/** Points every spawn of this test process at the fake (test files run in separate processes). */
export function useFakePi(): void {
  Object.assign(process.env, fakePiCommandEnv());
}

export const SCENARIOS = {
  /** Each prompt: thinking + reply with usage, then settle. */
  settle: { runs: [[{ type: "reply", thinking: true, usage: { input: 100, output: 20, cost: 0.01 } }]] },
  /** First run holds a 700 ms tool, so prompts sent meanwhile are steered. */
  steer: { runs: [[{ type: "tool", ms: 700 }, { type: "reply" }], [{ type: "reply" }]] },
  /** No output at all, not even command responses. */
  startupStall: { startup: [{ type: "silence" }] },
  /** Answers commands and starts the run, then goes silent. */
  inactivityStall: { runs: [[{ type: "silence" }]] },
  /** A silent tool; tests pick `ms` longer than the inactivity timeout. */
  longTool: (ms: number): FakePiScenario => ({ runs: [[{ type: "tool", ms }, { type: "reply" }]] }),
  crash: {
    runs: [
      [
        { type: "wait", ms: 50 },
        { type: "exit", code: 3, stderr: "boom" },
      ],
    ],
  },
  extensionLoadFailure: {
    startup: [
      {
        type: "exit",
        code: 1,
        stderr:
          'Error: Failed to load extension "/x/index.ts": Tool "swarm_post" conflicts with /y/index.ts\n' +
          'Hint: Start without extensions using "pi -ne".',
      },
    ],
  },
  settleGap: { settleGap: true, reject: "REJECT" },
  retainedQueueError: { retainQueueOnError: true, runs: [[{ type: "tool", ms: 700 }], [{ type: "reply" }]] },
  dialog: { startup: [{ type: "notify" }, { type: "dialog", method: "confirm" }] },
  compaction: { runs: [[{ type: "reply" }, { type: "compaction", usage: { input: 700, output: 600, cost: 0.004 } }]] },
  /** Ignores SIGTERM and has a grandchild in its group. */
  stubborn: { ignoreSigterm: true, startup: [{ type: "grandchild" }] },
} satisfies Record<string, FakePiScenario | ((ms: number) => FakePiScenario)>;

export interface FakePiRun {
  dir: string;
  logFile: string;
  /** For AgentLaunchSpec.env: the scenario and log of this agent. */
  env: Record<string, string>;
  spec(name?: string): AgentLaunchSpec;
  /** Every JSONL record the fake logged so far. */
  log(): Record<string, unknown>[];
  cleanup(): void;
}

export function createFakePiRun(scenario: FakePiScenario): FakePiRun {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-fake-pi-"));
  const scenarioFile = path.join(dir, "scenario.json");
  const logFile = path.join(dir, "log.jsonl");
  fs.writeFileSync(scenarioFile, JSON.stringify(scenario));
  const systemPromptFile = path.join(dir, "system-prompt.md");
  fs.writeFileSync(systemPromptFile, "You are a test agent.\n");
  const env = { FAKE_PI_SCENARIO: scenarioFile, FAKE_PI_LOG: logFile };
  return {
    dir,
    logFile,
    env,
    spec: (name = "Maria") => ({
      name,
      cwd: dir,
      sessionFile: path.join(dir, "sessions", name, "session.jsonl"),
      systemPromptFile,
      context: { extensionArgs: [], projectTrusted: false, model: null },
      env,
    }),
    log: () => {
      if (!fs.existsSync(logFile)) return [];
      const lines = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean);
      return lines.map((line): Record<string, unknown> => JSON.parse(line));
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Polls until `check` passes; the fake runs in real time, so tests wait on observable effects. */
export async function waitFor(check: () => boolean, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
