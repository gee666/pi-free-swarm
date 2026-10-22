import { openSwarmDb } from "../../../src/store/db.js";
import { mutateAcceptance } from "../../../src/broker/acceptance.js";

const [path, id, agent] = process.argv.slice(2);
if (!path || !id || !agent) throw new Error("Expected database, swarm and agent");
const db = openSwarmDb(path, { create: false });
try {
  mutateAcceptance(db, Number(id), agent, { action: "vote", verdict: "accepted", reason: "Task checked" }, Date.now());
  process.stdout.write("voted");
} finally {
  db.close();
}
