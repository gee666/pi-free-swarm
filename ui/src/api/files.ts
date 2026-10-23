import type { FilePreview } from "../../../src/api-file-types";
import { getJson } from "./http";

export function fetchFilePreview(
  swarmId: string,
  path: string,
  offset: number,
  version: string | undefined,
  signal: AbortSignal,
): Promise<FilePreview> {
  const query = new URLSearchParams({ path, offset: String(offset) });
  if (version !== undefined) query.set("version", version);
  return getJson<FilePreview>(`/api/swarms/${encodeURIComponent(swarmId)}/files/preview?${query}`, signal);
}
