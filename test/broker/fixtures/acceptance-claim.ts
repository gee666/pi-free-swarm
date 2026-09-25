import { openSwarmDb } from "../../../src/store/db.js";
import { mutateAcceptance } from "../../../src/broker/acceptance.js";
const [path, id, agent] = process.argv.slice(2);
if (!path || !id || !agent) throw new Error("Expected database, swarm and agent");
const db = openSwarmDb(path, { create: false });
try {
  mutateAcceptance(db, Number(id), agent, { action: "claim", revision: 0 }, Date.now());
  process.stdout.write("claimed");
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Stale acceptance revision")) throw error;
  process.stdout.write("stale");
} finally {
  db.close();
}
