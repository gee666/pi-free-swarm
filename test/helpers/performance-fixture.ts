import type { SwarmDb } from "../../src/store/db.js";
import { insertCriterion, saveBlocker, saveVote, criterionTasks } from "../../src/store/criteria.js";
import { linksSignature } from "../../src/broker/criterion-status.js";
import { count } from "../../src/store/rows.js";
import { seedSwarm, T0 } from "./temp-db.js";

/** Direct inserts keep fixture setup independent of mutation-side assessment costs. */
export function seedPerformanceFixture(db: SwarmDb, seed = 42) {
  let randomState = seed;
  const random = (max: number) => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState % max;
  };
  const agents = Array.from({ length: 45 }, (_, i) => `Agent${i}`);
  const swarm = seedSwarm(db, { agents });
  const criteria: number[] = [];
  const tasks: number[] = [];
  db.write(() => {
    db.sql
      .prepare("DELETE FROM task_criteria WHERE task_id IN (SELECT id FROM tasks WHERE swarm_id = ?)")
      .run(swarm.id);
    db.sql.prepare("DELETE FROM task_events WHERE swarm_id = ?").run(swarm.id);
    db.sql.prepare("DELETE FROM tasks WHERE swarm_id = ?").run(swarm.id);
    db.sql.prepare("DELETE FROM criterion_events WHERE swarm_id = ?").run(swarm.id);
    db.sql.prepare("DELETE FROM criteria WHERE swarm_id = ?").run(swarm.id);
    db.sql.prepare("UPDATE participants SET status = 'working' WHERE swarm_id = ? AND kind = 'agent'").run(swarm.id);
    for (let i = 0; i < 500; i++) {
      const id = insertCriterion(
        db,
        swarm.id,
        {
          group: `Group${random(12)}`,
          title: `Criterion ${i}`,
          body: `Requirement ${i}`,
          verification: "Run tests",
          source: "brief.md",
        },
        "Main",
        T0 + i,
      );
      criteria.push(id);
      if (random(9) === 0) db.sql.prepare("UPDATE criteria SET revision = 2 WHERE id = ?").run(id);
      if (random(20) === 0) db.sql.prepare("UPDATE criteria SET archived_at = ? WHERE id = ?").run(T0, id);
    }
    for (let i = 0; i < 300; i++) {
      const status = ["new", "claimed", "in_progress", "review", "accepted"][random(5)] ?? "new";
      const owner = status === "new" ? null : (agents[random(agents.length)] ?? null);
      const id = count(
        db.sql
          .prepare(
            `INSERT INTO tasks(swarm_id,title,body,status,owner,author,created_at,updated_at,accepted_at)
        VALUES (?,?,?,?,?,'Main',?,?,?)`,
          )
          .run(swarm.id, `Task ${i}`, `Implementation ${i}`, status, owner, T0, T0, status === "accepted" ? T0 : null)
          .lastInsertRowid,
      );
      tasks.push(id);
      for (let link = 0; link < 4; link++) {
        const criterionId = criteria[random(criteria.length)];
        if (criterionId !== undefined)
          db.sql.prepare("INSERT OR IGNORE INTO task_criteria VALUES (?, ?, 'Implementation')").run(id, criterionId);
      }
      const dependency = tasks[random(tasks.length)];
      if (dependency !== undefined && dependency !== id)
        db.sql.prepare("INSERT INTO task_dependencies VALUES (?, ?)").run(id, dependency);
      db.sql
        .prepare("INSERT INTO task_events(swarm_id,task_id,actor,kind,created_at) VALUES (?,?,'Main',?,?)")
        .run(swarm.id, id, status === "accepted" ? "review_accepted" : "created", T0 - random(14 * 3600000));
    }
    for (const id of criteria) {
      if (random(4) === 0)
        saveBlocker(db, {
          criterionId: id,
          revision: 1,
          reason: "Missing dependency",
          missing: "Access",
          attempted: "Checked",
          unblock: "Grant access",
          author: "Main",
          updatedAt: T0,
          rejectedRevision: random(3) === 0 ? 1 : null,
          decidedAt: null,
        });
      const signature = linksSignature(criterionTasks(db, id));
      for (const voter of agents.slice(0, 4))
        saveVote(db, {
          criterionId: id,
          voter,
          verdict:
            ["covered", "blocked", "gap"][random(3)] === "blocked" ? "blocked" : random(4) === 0 ? "gap" : "covered",
          reason: "Checked evidence",
          criterionRevision: 1,
          linksSignature: random(5) === 0 ? "stale" : signature,
          blockerRevision: 1,
          createdAt: T0,
        });
    }
    db.sql
      .prepare("UPDATE participants SET status = 'crashed' WHERE swarm_id = ? AND name = ?")
      .run(swarm.id, agents.at(-1) ?? "");
  });
  return { swarm, agents, criteria, tasks, now: T0 };
}
