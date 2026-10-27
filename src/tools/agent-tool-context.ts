import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { systemClock, type Clock } from "../clock.js";
import { requireOpenRun } from "../broker/run-ownership.js";
import { BrokerError } from "../broker/errors.js";
import { charCount, WORK_TEXT_ACCEPTED, WORK_TITLE_ACCEPTED, TEXT_MAX, TITLE_MAX } from "../limits.js";
import type { SwarmDb } from "../store/db.js";
import { agentToolResult } from "./agent-tool-result.js";

export interface AgentToolIdentity {
  getDb(): SwarmDb;
  swarmId: number;
  run: number;
  agentName: string;
  clock?: Clock;
}
export function workInput(identity: AgentToolIdentity) {
  return {
    swarmId: identity.swarmId,
    run: identity.run,
    actor: identity.agentName,
    now: (identity.clock ?? systemClock).now(),
  };
}
export function writeAgentTool<T>(identity: AgentToolIdentity, mutate: () => T): T {
  const db = identity.getDb();
  return db.write(() => {
    requireOpenRun(db, identity.swarmId, identity.run);
    return mutate();
  });
}
export function registerTextTool<S extends TSchema>(
  pi: Pick<ExtensionAPI, "registerTool">,
  name: string,
  parameters: S,
  description: string,
  execute: (params: Static<S>, ctx: ExtensionToolContext) => string | Promise<string>,
): void {
  pi.registerTool({
    name,
    label: name,
    description,
    promptSnippet: description,
    parameters,
    async execute(_callId, params, _signal, _update, ctx) {
      const input: unknown = params;
      if (!Value.Check(parameters, input))
        throw new BrokerError("validation", "Arguments do not match the tool schema.");
      validateAgentStrings(input);
      return agentToolResult(await execute(input, ctx));
    },
  });
}
function validateAgentStrings(value: unknown, field = "text"): void {
  if (typeof value === "string") {
    if (field === "cursor") return;
    const title = field === "title" || field === "group";
    const size = charCount(value.trim());
    if (size > (title ? WORK_TITLE_ACCEPTED : WORK_TEXT_ACCEPTED))
      throw new BrokerError(
        "validation",
        `${field} too long (${size} chars): keep it under ${title ? TITLE_MAX : TEXT_MAX}; put long material in a file and reference its path.`,
        field,
      );
  } else if (Array.isArray(value)) {
    for (const item of value) validateAgentStrings(item, field);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) validateAgentStrings(item, key);
  }
}

export function cursorAfter(cursor: string | undefined, scope: string): number {
  if (!cursor) return 0;
  try {
    const raw: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (
      typeof raw === "object" &&
      raw !== null &&
      "scope" in raw &&
      raw.scope === scope &&
      "after" in raw &&
      typeof raw.after === "number" &&
      Number.isSafeInteger(raw.after) &&
      raw.after >= 0
    )
      return raw.after;
  } catch {
    /* Invalid cursors must not silently restart a page. */
  }
  throw new BrokerError("validation", "Invalid cursor. Restart this read without a cursor.", "cursor");
}
export function nextCursor(after: number | null, scope: string): string | null {
  return after === null ? null : Buffer.from(JSON.stringify({ scope, after })).toString("base64url");
}
export function checkedQuery(query?: string): string | undefined {
  if (query && charCount(query.trim()) > WORK_TEXT_ACCEPTED)
    throw new BrokerError(
      "validation",
      `too long (${charCount(query.trim())} chars): keep it under ${TEXT_MAX}; put long material in a file and reference its path`,
      "query",
    );
  return query;
}
