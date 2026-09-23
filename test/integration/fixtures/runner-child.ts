// A swarm runner in its own process, for multi-process.test.ts. Args: project cwd, JSON of settings.env.
// Two agents with a 60 s stagger: the second one stays pending for the whole test.
import { startSwarm } from "../../../src/broker/swarm-run.js";
import { systemClock } from "../../../src/clock.js";
import { openSwarmDb, swarmDbPath } from "../../../src/store/db.js";
import { FAST } from "../run-fixture.js";

const [cwd, settingsEnv] = process.argv.slice(2);
const db = openSwarmDb(swarmDbPath(cwd), { create: true });
const env: Record<string, string> = JSON.parse(settingsEnv);

await startSwarm(
  {
    cwd,
    db,
    runnerPid: process.pid,
    clock: systemClock,
    settings: { port: null, minAgents: 1, maxAgents: 10, defaultAgents: 2, staggerSeconds: 60, env },
    launch: { extensionArgs: [], projectTrusted: false, model: null },
    boardUrl: () => null,
    notifyUser: () => undefined,
    timings: FAST,
  },
  { name: "elsewhere", taskPrompt: "Work.", agentAmount: 2 },
  {},
);
