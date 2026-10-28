import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SwarmDb } from "../store/db.js";
import { getConfigurationRevision } from "../store/configuration-revisions.js";
import { queueConfigurationChange } from "../store/runtime-configuration.js";
import { getSwarm } from "../store/swarm-queries.js";
import { int } from "../store/rows.js";
import { workText } from "./work-validation.js";
import { BrokerError } from "./errors.js";
import { requireActiveWorker } from "./worker-eligibility.js";

export function requestRetirement(
  db: SwarmDb,
  swarmId: number,
  name: string,
  run: number,
  handoff: string,
  now: number,
): { requestId: number; handoffFile: string; handoffPath: string } {
  return db.write(() => {
    const worker = requireActiveWorker(db, swarmId, name);
    const obligations = db.sql
      .prepare(
        "SELECT id FROM tasks WHERE swarm_id = ? AND owner = ? AND status IN ('claimed', 'in_progress', 'review') ORDER BY id",
      )
      .all(swarmId, worker);
    if (obligations.length > 0) {
      const tasks = obligations.map((row) => `#${int(row, "id")}`).join(", ");
      throw new BrokerError("validation", `Finish, release or hand off ${tasks} before retiring.`);
    }
    const swarm = getSwarm(db, swarmId, now);
    if (swarm === null) throw new BrokerError("not_found", `Swarm #${swarmId} not found.`);
    if (swarm.runCount !== run) {
      throw new BrokerError("validation", "This worker belongs to an older run; retirement was not requested.");
    }
    if (!swarm.acceptsMessages) {
      throw new BrokerError("validation", "This swarm is not admitting replacements; retirement was not requested.");
    }
    if (swarm.configuration === null) {
      throw new BrokerError(
        "validation",
        "Retirement requires saved worker assignments; inspect this run's configuration.",
      );
    }
    if (typeof handoff !== "string" || handoff.trim().length === 0) {
      throw new BrokerError(
        "validation",
        "handoff must contain your concise work summary and remaining work.",
        "handoff",
      );
    }
    const pending = db.sql
      .prepare(
        `SELECT id FROM configuration_requests
      WHERE swarm_id = ? AND run = ? AND status IN ('pending', 'applying')
      AND json_extract(change, '$.type') = 'retireAgent' AND json_extract(change, '$.name') = ? LIMIT 1`,
      )
      .get(swarmId, run, worker);
    if (pending !== undefined) {
      throw new BrokerError(
        "validation",
        `Retirement request #${int(pending, "id")} is already pending; do not submit it again.`,
      );
    }
    workText(handoff, "handoff", worker);
    const handoffFile = path.join("handoffs", String(swarmId), `${randomUUID()}.md`);
    const absolute = path.join(db.dataDir, handoffFile);
    mkdirSync(path.dirname(absolute), { recursive: true });
    // Keep the handoff if queueing fails uncertainly, rather than deleting potentially accepted evidence.
    writeFileSync(absolute, handoff, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const request = queueConfigurationChange(
      db,
      swarmId,
      worker,
      { type: "retireAgent", name: worker, handoffFile },
      getConfigurationRevision(db, swarmId, run),
      now,
    );
    return { requestId: request.id, handoffFile, handoffPath: absolute };
  });
}
