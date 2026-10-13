import type { SendMessageResponse, ThreadResponse } from "../../../src/api-types";
import { getJson, postJson } from "./http";

const watcherUrl = (swarmId: string) => `/api/swarms/${encodeURIComponent(swarmId)}/watcher`;

export function fetchWatcher(swarmId: string, signal: AbortSignal): Promise<ThreadResponse | null> {
  return getJson<ThreadResponse | null>(watcherUrl(swarmId), signal);
}

export function sendWatcherMessage(swarmId: string, text: string): Promise<SendMessageResponse> {
  return postJson<SendMessageResponse>(watcherUrl(swarmId), { text });
}
