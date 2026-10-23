import { PAGE_DEFAULT_COUNT } from "../../../src/constants";
import type { AcceptanceHistoryPage } from "../../../src/store/acceptance-types";
import { getJson } from "./http";

export function fetchAcceptanceHistory(
  swarmId: number,
  signal: AbortSignal,
  after?: string,
): Promise<AcceptanceHistoryPage> {
  const query = new URLSearchParams({ count: String(PAGE_DEFAULT_COUNT) });
  if (after) query.set("after", after);
  return getJson<AcceptanceHistoryPage>(`/api/swarms/${swarmId}/acceptance/history?${query}`, signal);
}
