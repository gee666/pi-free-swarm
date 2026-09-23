// Spawned by parent-watch.test.ts: watches argv[2] with a clock running 100× faster, and never exits
// on its own, so only the SIGKILL backstop can end it.
import { startParentWatch } from "../../src/agents/parent-watch.js";
import { systemClock, type Clock } from "../../src/clock.js";

const SPEEDUP = 100;
const fastClock: Clock = {
  now: () => systemClock.now(),
  after: (ms, fn) => systemClock.after(ms / SPEEDUP, fn),
  every: (ms, fn) => systemClock.every(ms / SPEEDUP, fn),
};

process.on("SIGTERM", () => undefined);
startParentWatch({
  runnerPid: Number(process.argv[2]),
  clock: fastClock,
  abort: () => process.stdout.write("abort\n"),
  shutdown: () => process.stdout.write("shutdown\n"),
});
process.stdout.write("watching\n");
