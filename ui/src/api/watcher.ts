import type { SendMessageResponse, WatcherResponse } from "../../../src/api-types";
import { getJson, postJson } from "./http";

const watcherUrl = (swarmId: string) => `/api/swarms/${encodeURIComponent(swarmId)}/watcher`;

export function fetchWatcher(swarmId: string, signal: AbortSignal): Promise<WatcherResponse | null> {
  return getJson<WatcherResponse | null>(watcherUrl(swarmId), signal);
}

export function sendWatcherMessage(swarmId: string, text: string): Promise<SendMessageResponse> {
  return postJson<SendMessageResponse>(watcherUrl(swarmId), { text });
}
