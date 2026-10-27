import { syncSkills } from "../skills/index.js";
import type { SwarmDb } from "../store/db.js";
import { insertEvent } from "../store/events.js";
import { listSwarms } from "../store/swarm-queries.js";

export function syncSkillsAndNotify(db: SwarmDb, now: number) {
  return db.write(() => {
    const result = syncSkills(db, now);
    if (result.changes.length === 0) return result;
    for (const swarm of listSwarms(db, now))
      for (const change of result.changes) insertEvent(db, swarm.id, "skill.changed", { id: change.name }, now);
    return result;
  });
}
