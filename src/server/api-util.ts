// Plumbing shared by the REST routes: route matching, JSON bodies, query parsing and error mapping.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiErrorBody, ApiErrorCode, SwarmListItem } from "../api-types.js";
import { BrokerError } from "../broker/errors.js";
import { checkPage } from "../broker/validate.js";
import type { Clock } from "../clock.js";
import { PAGE_DEFAULT_COUNT } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import type { PidAlive } from "../store/locks.js";
import { getSwarm } from "../store/swarm-queries.js";
import { sendJson } from "./http.js";
import { SessionCursorError, type SessionReader } from "./sessions.js";

export interface ApiDeps {
  db: SwarmDb;
  clock: Clock;
  sessions: SessionReader;
  alive?: PidAlive;
  onError?(message: string): void;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

export interface Reply {
  status: number;
  body: unknown;
}

/** Generic only so each handler's body is checked against its response type from api-types.ts. */
export function reply<T>(body: T, status = 200): Reply {
  return { status, body };
}

export interface RouteContext {
  req: IncomingMessage;
  url: URL;
  params: RouteParams;
}

export interface ApiRoute {
  method: "GET" | "POST";
  /** Segments starting with `:` are parameters; names ending in `Id` only match digits. */
  pattern: string;
  handle(ctx: RouteContext): Reply | Promise<Reply>;
}

export class RouteParams {
  constructor(private readonly values: ReadonlyMap<string, string>) {}

  id(name: string): number {
    return Number(this.text(name));
  }

  text(name: string): string {
    const value = this.values.get(name);
    if (value === undefined) throw new Error(`Route has no parameter ${name}`);
    return value;
  }
}

const ID_SEGMENT = /^\d{1,15}$/;

/** `null` when the path does not fit the pattern (wrong literal, non-numeric id, malformed escape). */
export function matchRoute(pattern: string, pathname: string): RouteParams | null {
  const expected = pattern.split("/");
  const actual = pathname.split("/");
  if (expected.length !== actual.length) return null;
  const values = new Map<string, string>();
  for (let i = 0; i < expected.length; i++) {
    const part = expected[i];
    if (!part.startsWith(":")) {
      if (part !== actual[i]) return null;
      continue;
    }
    let value: string;
    try {
      value = decodeURIComponent(actual[i]);
    } catch {
      return null;
    }
    if (value === "" || (part.endsWith("Id") && !ID_SEGMENT.test(value))) return null;
    values.set(part.slice(1), value);
  }
  return new RouteParams(values);
}

export function notFound(message: string): ApiFailure {
  return new ApiFailure(404, "not_found", message);
}

export function requireSwarmItem(deps: ApiDeps, swarmId: number): SwarmListItem {
  const swarm = getSwarm(deps.db, swarmId, deps.clock.now(), deps.alive);
  if (swarm === null) throw notFound(`Swarm #${swarmId} not found.`);
  return swarm;
}

// ── Query and body parsing ───────────────────────────────────────────────────

/** A missing parameter gives the default; anything but an integer gives NaN for the range check to reject. */
export function intQuery(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  return /^-?\d{1,15}$/.test(raw) ? Number(raw) : Number.NaN;
}

export function pageQuery(url: URL): { count: number; offset: number } {
  const page = { count: intQuery(url, "count", PAGE_DEFAULT_COUNT), offset: intQuery(url, "offset", 0) };
  checkPage(page);
  return page;
}

const BODY_MAX_BYTES = 64 * 1024;

function badRequest(message: string, field?: string): ApiFailure {
  return new ApiFailure(400, "bad_request", message, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Requiring a JSON content type also keeps other web pages from posting here: browsers only send it
 * cross-origin after a CORS preflight, which this server never approves.
 */
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw badRequest("Content-Type must be application/json.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > BODY_MAX_BYTES) throw badRequest(`Request body is larger than ${BODY_MAX_BYTES / 1024} KB.`);
    chunks.push(buffer);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw badRequest("Request body is not valid JSON.");
  }
  if (!isRecord(body)) throw badRequest("Request body must be a JSON object.");
  return body;
}

export function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") throw badRequest(`"${key}" must be a string.`, key);
  return value;
}

function arrayOf<T>(value: unknown, guard: (item: unknown) => item is T): T[] | null {
  if (!Array.isArray(value)) return null;
  const items: unknown[] = value;
  return items.every(guard) ? items : null;
}

const isString = (item: unknown): item is string => typeof item === "string";
const isId = (item: unknown): item is number => typeof item === "number" && Number.isSafeInteger(item) && item > 0;

export function stringArrayField(body: Record<string, unknown>, key: string): string[] {
  const value = arrayOf(body[key], isString);
  if (value === null) throw badRequest(`"${key}" must be an array of strings.`, key);
  return value;
}

export function idArrayField(body: Record<string, unknown>, key: string): number[] {
  const value = arrayOf(body[key], isId);
  if (value === null) throw badRequest(`"${key}" must be an array of positive integers.`, key);
  return value;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** `null` for codes the API never triggers (resume conflicts); they surface as internal errors. */
function brokerStatus(code: BrokerError["code"]): { status: number; code: ApiErrorCode } | null {
  switch (code) {
    case "validation":
      return { status: 400, code: "validation" };
    case "not_member":
      return { status: 403, code: "not_member" };
    case "not_found":
      return { status: 404, code: "not_found" };
    case "swarm_running":
      return null;
  }
}

function errorReply(error: unknown, onError?: (message: string) => void): { status: number; body: ApiErrorBody } {
  const body = (code: ApiErrorCode, message: string, field?: string): ApiErrorBody =>
    field === undefined ? { error: code, message } : { error: code, message, field };
  if (error instanceof ApiFailure) return { status: error.status, body: body(error.code, error.message, error.field) };
  const mapped = error instanceof BrokerError ? brokerStatus(error.code) : null;
  if (error instanceof BrokerError && mapped !== null) {
    return { status: mapped.status, body: body(mapped.code, error.message, error.field) };
  }
  if (error instanceof SessionCursorError) return { status: 400, body: body("validation", error.message, error.field) };
  onError?.(`API error: ${error instanceof Error ? error.message : String(error)}`);
  return { status: 500, body: body("internal", "Internal server error.") };
}

export function sendError(res: ServerResponse, error: unknown, onError?: (message: string) => void): void {
  const { status, body } = errorReply(error, onError);
  sendJson(res, status, body);
}
