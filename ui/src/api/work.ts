import type { SessionPage, SessionQuery } from "../../../src/api-types";
import { getJson } from "./http";

/** One page of an agent's session, newest first; cursors come from earlier pages and stay opaque. */
export function fetchSessionPage(
  swarmId: number | string,
  name: string,
  query: SessionQuery,
  signal: AbortSignal,
): Promise<SessionPage> {
  const params = new URLSearchParams();
  if (query.before !== undefined) params.set("before", query.before);
  if (query.after !== undefined) params.set("after", query.after);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const url = `/api/swarms/${encodeURIComponent(swarmId)}/agents/${encodeURIComponent(name)}/session?${params}`;
  return getJson<SessionPage>(url, signal);
}
