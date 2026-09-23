// Child process for the host election test: argv = projectDir uiDir pollMs firstPort lastPort.
// Competes for the board of `projectDir` until killed.
import { ServerHost } from "../../../src/server/host.js";
import { openSwarmDb, swarmDbPath } from "../../../src/store/db.js";

const [cwd, uiDir, pollArg, firstArg, lastArg] = process.argv.slice(2);
const pollMs = Number(pollArg);
const candidates: number[] = [];
for (let port = Number(firstArg); port <= Number(lastArg); port++) candidates.push(port);

const db = openSwarmDb(swarmDbPath(cwd), { create: true });
const host = new ServerHost({
  cwd,
  uiDir,
  getDb: () => db,
  intervals: { pollMs, heartbeatMs: pollMs },
  ports: () => ({ candidates, explicit: false }),
  onError: (message) => console.error(message),
});
host.start();
process.stdout.write("started\n");
