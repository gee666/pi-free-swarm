// A real run owner separate from the board/test process. No provider requests leave the local fixture.
import { startSwarm, resumeSwarm } from "../../../src/broker/swarm-run.js";
import { loadSettings } from "../../../src/settings.js";
import { openSwarmDb, swarmDbPath } from "../../../src/store/db.js";
import { FakeClock } from "../../agents/fake-clock.js";
import { FAST } from "../run-fixture.js";

const [cwd, amount, mode, savedId] = process.argv.slice(2);
const db = openSwarmDb(swarmDbPath(cwd), { create: false });
const clock = new FakeClock(Date.now());
const cancel = new AbortController();
const stop = () => cancel.abort();
process.on("SIGTERM", stop);
process.on("disconnect", stop);
process.on("message", (message: unknown) => {
  if (typeof message !== "object" || message === null || !("advance" in message) || typeof message.advance !== "number")
    return;
  clock.advance(message.advance);
  process.send?.({ advanced: message.advance });
});
try {
  const env = {
    cwd,
    db,
    clock,
    runnerPid: process.pid,
    settings: loadSettings(cwd).settings,
    launch: {
      extensionArgs: [],
      projectTrusted: false,
      model: { provider: "fixture", modelId: "test", thinkingLevel: "off" },
    },
    boardUrl: () => null,
    notifyUser: () => undefined,
    timings: FAST,
  };
  const result =
    mode === "resume"
      ? await resumeSwarm(
          env,
          { swarmId: Number(savedId), message: "User approved this explicit resume; verify saved artifacts." },
          { signal: cancel.signal },
        )
      : await startSwarm(
          env,
          {
            name: "runtime-config",
            taskPrompt: "Preserve live roster and configuration evidence.",
            acceptanceCriteria: ["Only explicit User changes alter the active roster and budget ceilings."],
            agentAmount: Number(amount),
          },
          { signal: cancel.signal },
        );
  console.log(JSON.stringify({ end: result.end, run: result.run, stopReason: result.stopReason }));
} finally {
  process.off("SIGTERM", stop);
  process.off("disconnect", stop);
  db.close();
  if (process.connected) process.disconnect?.();
}
