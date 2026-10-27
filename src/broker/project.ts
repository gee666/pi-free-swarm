import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MAIN_NAME, SWARM_DIR } from "../constants.js";
import { TITLE_MAX } from "../limits.js";
import type { ProjectRecord } from "../api-work-types.js";
import type { SwarmDb } from "../store/db.js";
import { insertCriterion } from "../store/criteria.js";
import { insertEvent } from "../store/events.js";
import { bumpScope, getProject, saveBriefPath, saveIntent, saveScopeApproval } from "../store/project.js";
import { addTaskEvent, insertTask, replaceTaskLinks } from "../store/tasks.js";
import { BrokerError } from "./errors.js";
import {
  checkRevision,
  requireTask,
  userOnly,
  workText,
  type RevisionInput,
  type WorkInput,
} from "./work-validation.js";
import { storedWorkText } from "./work-text.js";
import { writeWork } from "./work-write.js";

export function readProject(db: SwarmDb, swarmId: number): ProjectRecord {
  const project = getProject(db, swarmId);
  if (!project) throw new BrokerError("not_found", `Swarm #${swarmId} not found.`);
  return project;
}
export function updateProjectIntent(
  db: SwarmDb,
  input: WorkInput & RevisionInput & { summary: string; path: string },
): ProjectRecord {
  return writeWork(db, input, (actor) => {
    const project = readProject(db, input.swarmId);
    checkRevision(project.intentRevision, input.expectedRevision);
    const summary = storedWorkText(db, input.swarmId, input.summary, "summary", actor);
    const intentPath = workText(input.path, "path", actor);
    saveIntent(db, input.swarmId, summary, intentPath, actor);
    insertEvent(db, input.swarmId, "project.changed", { id: input.swarmId }, input.now);
    return readProject(db, input.swarmId);
  });
}
export function approveScope(db: SwarmDb, input: WorkInput & RevisionInput): ProjectRecord {
  return writeWork(db, input, (actor) => {
    userOnly(actor);
    checkRevision(readProject(db, input.swarmId).scopeRevision, input.expectedRevision);
    saveScopeApproval(db, input.swarmId, input.now);
    insertEvent(db, input.swarmId, "project.changed", { id: input.swarmId }, input.now);
    return readProject(db, input.swarmId);
  });
}

/** Seeding uses Main attribution, not the agent/User mutation entry points. */
export function seedWorkGraph(
  db: SwarmDb,
  swarmId: number,
  brief: string,
  mainCriteria: readonly string[],
  now: number,
): void {
  db.write(() => seed(db, swarmId, brief, mainCriteria, now));
}
function seed(db: SwarmDb, swarmId: number, brief: string, mainCriteria: readonly string[], now: number): void {
  if (readProject(db, swarmId).briefPath !== null) throw new BrokerError("validation", "Work graph is already seeded.");
  const briefPath = path.join(SWARM_DIR, "work", String(swarmId), "brief.md");
  const absolute = path.join(db.dataDir, "work", String(swarmId), "brief.md");
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, brief, "utf8");
  saveBriefPath(db, swarmId, briefPath);
  const planningId = insertCriterion(
    db,
    swarmId,
    {
      group: "Planning",
      title: "Record the user intent and establish acceptance coverage",
      body: "Record the full user intent and cover it with exhaustive grouped acceptance criteria.",
      verification: "Read the intent file and compare the grouped criteria against the brief.",
      source: briefPath,
    },
    MAIN_NAME,
    now,
  );
  bumpScope(db, swarmId);
  insertEvent(db, swarmId, "criterion.changed", { id: planningId }, now);
  for (const title of ["Record the user intent", "Draft acceptance criteria"]) {
    const id = insertTask(db, swarmId, { title, body: `Read ${briefPath}. ${title}.`, author: MAIN_NAME }, now);
    replaceTaskLinks(db, id, [{ criterionId: planningId, contribution: title }]);
    addTaskEvent(db, requireTask(db, swarmId, id), MAIN_NAME, "created", now);
    insertEvent(db, swarmId, "task.changed", { id }, now);
  }
  for (const body of mainCriteria) {
    const id = insertCriterion(
      db,
      swarmId,
      {
        group: "Main",
        title: Array.from(body).slice(0, TITLE_MAX).join(""),
        body,
        verification: "Verify the requirement against task evidence.",
        source: briefPath,
      },
      MAIN_NAME,
      now,
    );
    bumpScope(db, swarmId);
    insertEvent(db, swarmId, "criterion.changed", { id }, now);
  }
  insertEvent(db, swarmId, "project.changed", { id: swarmId }, now);
}
