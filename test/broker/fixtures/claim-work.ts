import { openSwarmDb } from "../../../src/store/db.js";
import { claimTask } from "../../../src/broker/task-ownership.js";

const [file, swarm, id, actor] = process.argv.slice(2);
if (!file || !swarm || !id || !actor) throw new Error("Missing claim fixture arguments.");
const db = openSwarmDb(file, { create: false });
process.once("message", () => {
  let result: { ok: boolean; message?: string };
  try {
    claimTask(db, { swarmId: Number(swarm), id: Number(id), actor, now: Date.now() });
    result = { ok: true };
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    db.close();
  }
  process.send?.(result, () => process.disconnect?.());
});
process.send?.("ready");
