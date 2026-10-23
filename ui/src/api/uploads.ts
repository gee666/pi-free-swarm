import { postBytes } from "./http";

export function uploadFile(swarmId: string, file: File, signal?: AbortSignal): Promise<{ path: string }> {
  return postBytes(
    `/api/swarms/${encodeURIComponent(swarmId)}/files/upload?name=${encodeURIComponent(file.name)}`,
    file,
    signal,
  );
}
