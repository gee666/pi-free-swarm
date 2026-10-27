import type { IncomingMessage } from "node:http";
import { searchConfiguration } from "../search/configuration.js";
import type { CreateCriterionRequest, CreateTaskRequest, CriterionLink } from "../api-types.js";
import type { SwarmDb } from "../store/db.js";
import { badRequest, idArrayField, isRecord, readUserJsonBody, stringField } from "./api-util.js";

export function searchSettings(db: SwarmDb) {
  return searchConfiguration(db).settings;
}
export function recordField(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) throw badRequest(`${key} must be an object.`, key);
  return value;
}
export async function readWorkBody(req: IncomingMessage) {
  const body = await readUserJsonBody(req);
  if (body.actor !== undefined || body.from !== undefined)
    throw badRequest("HTTP work actions always act as User.", "actor");
  return body;
}
export function integerField(body: Record<string, unknown>, key: string, minimum = 0): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
    throw badRequest(`${key} must be a safe integer >= ${minimum}.`, key);
  return value;
}
export function revision(body: Record<string, unknown>) {
  return body.expectedRevision === undefined ? undefined : integerField(body, "expectedRevision");
}
export function booleanField(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined || typeof value === "boolean") return value;
  throw badRequest(`${key} must be true or false.`, key);
}
export function choice<T extends string>(value: unknown, choices: readonly T[], key: string): T {
  const found = choices.find((item) => item === value);
  if (found === undefined) throw badRequest(`${key} must be one of: ${choices.join(", ")}.`, key);
  return found;
}
export function criterionFields(body: Record<string, unknown>): Partial<CreateCriterionRequest> {
  const fields: Partial<CreateCriterionRequest> = {};
  const keys: (keyof CreateCriterionRequest)[] = ["group", "title", "body", "verification", "source"];
  for (const key of keys) if (body[key] !== undefined) fields[key] = stringField(body, key);
  return fields;
}
export function createCriterionFields(body: Record<string, unknown>): CreateCriterionRequest {
  return {
    group: stringField(body, "group"),
    title: stringField(body, "title"),
    body: stringField(body, "body"),
    verification: stringField(body, "verification"),
    source: body.source === undefined ? "" : stringField(body, "source"),
  };
}
function criterionLinks(value: unknown): CriterionLink[] {
  if (!Array.isArray(value)) throw badRequest("criteria must be an array.", "criteria");
  const items: unknown[] = value;
  return items.map((item) => {
    const link = recordField(item, "criteria");
    return { criterionId: integerField(link, "criterionId", 1), contribution: stringField(link, "contribution") };
  });
}
export function taskFields(body: Record<string, unknown>): Partial<Omit<CreateTaskRequest, "claim">> {
  const fields: Partial<Omit<CreateTaskRequest, "claim">> = {};
  const keys: ("title" | "body")[] = ["title", "body"];
  for (const key of keys) if (body[key] !== undefined) fields[key] = stringField(body, key);
  if (body.criteria !== undefined) fields.criteria = criterionLinks(body.criteria);
  if (body.dependsOn !== undefined) fields.dependsOn = idArrayField(body, "dependsOn");
  return fields;
}
export function createTaskFields(body: Record<string, unknown>): CreateTaskRequest {
  return {
    title: stringField(body, "title"),
    body: stringField(body, "body"),
    criteria: criterionLinks(body.criteria),
    dependsOn: body.dependsOn === undefined ? undefined : idArrayField(body, "dependsOn"),
    claim: booleanField(body, "claim"),
  };
}
export function postLinkFields(body: Record<string, unknown>) {
  return {
    taskIds: body.taskIds === undefined ? undefined : idArrayField(body, "taskIds"),
    criterionIds: body.criterionIds === undefined ? undefined : idArrayField(body, "criterionIds"),
  };
}
export function textQuery(url: URL, key: string): string | undefined {
  return url.searchParams.get(key) ?? undefined;
}
export function booleanQuery(url: URL, key: string): boolean | undefined {
  const value = textQuery(url, key);
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw badRequest(`${key} must be true or false.`, key);
}
export function positiveQuery(url: URL, key: string): number | undefined {
  const value = textQuery(url, key);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw badRequest(`${key} must be a positive integer.`, key);
  return integerField({ [key]: Number(value) }, key, 1);
}
export function statuses<T extends string>(url: URL, choices: readonly T[]): T[] | undefined {
  const values = [...url.searchParams.getAll("status"), ...url.searchParams.getAll("status[]")];
  return values.length
    ? values.flatMap((value) => value.split(",").map((item) => choice(item, choices, "status")))
    : undefined;
}
export function searchQuery(url: URL) {
  return { query: textQuery(url, "query"), cursor: textQuery(url, "cursor"), limit: positiveQuery(url, "limit") };
}
