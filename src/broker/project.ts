import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MAIN_NAME, SWARM_DIR } from "../constants.js";
import { TITLE_MAX } from "../limits.js";
import type { ProjectRecord } from "../api-work-types.js";
import type { SwarmDb } from "../store/db.js";
import { insertCriterion, listCriteria } from "../store/criteria.js";
import { insertEvent } from "../store/events.js";
import { bumpScope, getProject, saveBriefPath, saveIntent, saveScopeApproval } from "../store/project.js";
import { addTaskEvent, insertTask, replaceTaskLinks, taskLinks, listTasks } from "../store/tasks.js";
import { BrokerError } from "./errors.js";
import { text } from "../store/rows.js";
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

export function ensureWorkGraphInitialized(
  db: SwarmDb,
  swarmId: number,
  now: number,
  mainCriteria: readonly string[] = [],
): void {
  db.write(() => {
    const row = db.sql.prepare("SELECT task_prompt FROM swarms WHERE id = ?").get(swarmId);
    if (!row) throw new BrokerError("not_found", `Swarm #${swarmId} not found.`);
    seed(db, swarmId, text(row, "task_prompt"), mainCriteria, now);
  });
}

export function recordResumeFeedback(db: SwarmDb, swarmId: number, feedback: string, now: number): number {
  const body = storedWorkText(db, swarmId, feedback, "feedback", MAIN_NAME);
  const title = Array.from(feedback.trim().split(/\r?\n/)[0] ?? "")
    .slice(0, TITLE_MAX)
    .join("");
  const id = insertCriterion(
    db,
    swarmId,
    {
      group: "Feedback",
      title,
      body,
      verification: "Link tasks, complete independent review, and collect current votes.",
      source: "",
    },
    MAIN_NAME,
    now,
  );
  bumpScope(db, swarmId);
  insertEvent(db, swarmId, "criterion.changed", { id }, now);
  insertEvent(db, swarmId, "project.changed", { id: swarmId }, now);
  return id;
}

function seed(db: SwarmDb, swarmId: number, brief: string, mainCriteria: readonly string[], now: number): void {
  const before = readProject(db, swarmId);
  const briefPath = path.join(SWARM_DIR, "work", String(swarmId), "brief.md");
  const absolute = path.join(db.dataDir, "work", String(swarmId), "brief.md");
  if (readProject(db, swarmId).briefPath === null) {
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, brief, "utf8");
    saveBriefPath(db, swarmId, briefPath);
  }
  const existing = listCriteria(db, swarmId, true).find(
    (criterion) => criterion.group === "Planning" && criterion.author === MAIN_NAME,
  );
  const planningId =
    existing?.id ??
    insertCriterion(
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
  if (!existing) {
    bumpScope(db, swarmId);
    insertEvent(db, swarmId, "criterion.changed", { id: planningId }, now);
  }
  for (const title of ["Record the user intent", "Draft acceptance criteria"]) {
    if (
      listTasks(db, swarmId).some(
        (task) =>
          task.author === MAIN_NAME &&
          task.title === title &&
          taskLinks(db, task.id).some((link) => link.criterionId === planningId),
      )
    )
      continue;
    const id = insertTask(db, swarmId, { title, body: `Read ${briefPath}. ${title}.`, author: MAIN_NAME }, now);
    replaceTaskLinks(db, id, [{ criterionId: planningId, contribution: title }]);
    addTaskEvent(db, requireTask(db, swarmId, id), MAIN_NAME, "created", now);
    insertEvent(db, swarmId, "task.changed", { id }, now);
  }
  if (before.briefPath === null) {
    for (const body of mainCriteria) {
      const id = insertCriterion(
        db,
        swarmId,
        {
          group: "Main",
          title: Array.from(body).slice(0, TITLE_MAX).join(""),
          body: storedWorkText(db, swarmId, body, "body", MAIN_NAME),
          verification: "Verify the requirement against task evidence.",
          source: briefPath,
        },
        MAIN_NAME,
        now,
      );
      bumpScope(db, swarmId);
      insertEvent(db, swarmId, "criterion.changed", { id }, now);
    }
  }
  if (before.briefPath === null || before.scopeRevision !== readProject(db, swarmId).scopeRevision)
    insertEvent(db, swarmId, "project.changed", { id: swarmId }, now);
}
