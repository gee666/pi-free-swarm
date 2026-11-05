import { writeFileSync } from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";
import { DEFAULT_MAX_RPC_FRAME_BYTES } from "../../src/agents/jsonl.js";
import { DEFAULT_TIMINGS } from "../../src/broker/run-types.js";
import { WATCHER_NAME, SETTINGS_FILE } from "../../src/constants.js";
import { loadSettings } from "../../src/settings.js";
import { saveRunConfiguration } from "../../src/store/run-configuration.js";
import { readWatcherChat } from "../../src/store/watcher-chat.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { createFakePiRun, useFakePi, type FakePiScenario } from "../fixtures/fake-pi/harness.js";
import { startTestBoard, waitFor } from "./helpers.js";

export async function watcherBoard(
  t: TestContext,
  scenario: FakePiScenario = { runs: [[{ type: "reply", text: "Recorded answer", usage: { cost: 0.01 } }]] },
) {
  useFakePi();
  const fake = createFakePiRun(scenario);
  const board = await startTestBoard();
  t.after(async () => {
    await board.close();
    fake.cleanup();
  });
  const { db } = board.temp;
  const swarm = seedSwarm(db, { now: Date.now(), agents: ["Maria"] });
  const settings = loadSettings(board.temp.cwd).settings;
  writeFileSync(path.join(db.dataDir, SETTINGS_FILE), JSON.stringify({ env: fake.env }));
  saveRunConfiguration(
    db,
    swarm.id,
    1,
    {
      version: 1,
      workers: [{ name: "Maria", provider: "worker-provider", modelId: "worker-model", thinkingLevel: null }],
      watcher: { provider: "watcher-provider", modelId: "watcher-model", thinkingLevel: "high" },
      launch: { projectTrusted: false, noExtensions: true, extensionArgs: [] },
      timing: {
        staggerSeconds: settings.staggerSeconds,
        idleReminderDelay: settings.idleReminderDelay,
        ...DEFAULT_TIMINGS,
        reviveBackoffMs: [...DEFAULT_TIMINGS.reviveBackoffMs],
        startupTimeoutMs: 1_000,
        startupRetries: 0,
      },
      limits: { maxRpcFrameBytes: settings.maxRpcFrameBytes ?? DEFAULT_MAX_RPC_FRAME_BYTES },
      budget: { moneyUsd: null, timeSeconds: null, gracefulShutdown: false },
    },
    Date.now(),
  );
  const url = `${board.base}/api/swarms/${swarm.id}/watcher`;
  return {
    ...board,
    fake,
    swarm,
    url,
    snapshot: () => readWatcherChat(db, swarm.id),
    done: () =>
      waitFor(() => {
        const chat = readWatcherChat(db, swarm.id);
        return chat.status !== "working" ? chat : null;
      }),
    watcher: () =>
      db.sql.prepare("SELECT * FROM participants WHERE swarm_id = ? AND name = ?").get(swarm.id, WATCHER_NAME),
  };
}
