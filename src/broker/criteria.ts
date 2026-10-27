import type { CriterionRecord } from "../api-work-types.js";
import type { SwarmDb } from "../store/db.js";
import { insertCriterion, saveCriterion, addCriterionEvent, type CriterionFields } from "../store/criteria.js";
import { BrokerError } from "./errors.js";
import { storedWorkText } from "./work-text.js";
import {
  checkRevision,
  requireCriterion,
  userOnly,
  workText,
  type RevisionInput,
  type WorkInput,
} from "./work-validation.js";
import { writeWork } from "./work-write.js";

function fieldsFor(
  db: SwarmDb,
  input: WorkInput,
  actor: string,
  fields: CriterionFields,
  changed?: Partial<CriterionFields>,
): CriterionFields {
  const field = (key: keyof CriterionFields) => {
    if (changed && changed[key] === undefined) return fields[key];
    return key === "title" || key === "group"
      ? workText(fields[key], key, actor, key === "title")
      : storedWorkText(db, input.swarmId, fields[key], key, actor, key === "source");
  };
  return {
    group: field("group"),
    title: field("title"),
    body: field("body"),
    verification: field("verification"),
    source: field("source"),
  };
}
export function createCriterion(db: SwarmDb, input: WorkInput & CriterionFields): CriterionRecord {
  return writeWork(db, input, (actor) => {
    const fields = fieldsFor(db, input, actor, input);
    const id = insertCriterion(db, input.swarmId, fields, actor, input.now);
    return requireCriterion(db, input.swarmId, id);
  });
}
export function editCriterion(
  db: SwarmDb,
  input: WorkInput & { id: number; expectedRevision: number; fields: Partial<CriterionFields> },
): CriterionRecord {
  return writeWork(db, input, (actor) => {
    const criterion = requireCriterion(db, input.swarmId, input.id);
    checkRevision(criterion.revision, input.expectedRevision, true);
    const fields = fieldsFor(db, input, actor, { ...criterion, ...input.fields }, input.fields);
    const updated = {
      ...criterion,
      ...fields,
      revision: criterion.revision + 1,
      updatedAt: input.now,
      updatedBy: actor,
    };
    saveCriterion(db, updated);
    addCriterionEvent(db, input.swarmId, criterion.id, actor, "edited", updated.body, input.now);
    return updated;
  });
}
export function archiveCriterion(db: SwarmDb, input: WorkInput & RevisionInput & { id: number }): CriterionRecord {
  return setArchived(db, input, true);
}
export function restoreCriterion(db: SwarmDb, input: WorkInput & RevisionInput & { id: number }): CriterionRecord {
  return setArchived(db, input, false);
}
function setArchived(
  db: SwarmDb,
  input: WorkInput & RevisionInput & { id: number },
  archive: boolean,
): CriterionRecord {
  return writeWork(db, input, (actor) => {
    if (!archive) userOnly(actor);
    const criterion = requireCriterion(db, input.swarmId, input.id, true);
    checkRevision(criterion.revision, input.expectedRevision);
    if ((criterion.archivedAt !== null) === archive)
      throw new BrokerError("validation", `Criterion #${input.id} is already ${archive ? "archived" : "active"}.`);
    const updated = {
      ...criterion,
      revision: criterion.revision + 1,
      archivedAt: archive ? input.now : null,
      updatedAt: input.now,
      updatedBy: actor,
    };
    saveCriterion(db, updated);
    addCriterionEvent(db, input.swarmId, criterion.id, actor, archive ? "archived" : "restored", "", input.now);
    return updated;
  });
}
