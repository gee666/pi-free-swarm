import { Buffer } from "node:buffer";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  withFileMutationQueue,
  type AgentToolResult,
} from "@earendil-works/pi-coding-agent";

/** Preserve complete results outside model context when a history or attestation grows large. */
export async function agentToolResult(text: string): Promise<AgentToolResult<{ fullOutputPath: string } | undefined>> {
  const preview = truncateHead(text);
  if (!preview.truncated) return { content: [{ type: "text", text }], details: undefined };
  const dir = await mkdtemp(path.join(tmpdir(), "pi-swarm-result-"));
  const fullOutputPath = path.join(dir, "result.txt");
  await withFileMutationQueue(fullOutputPath, () => writeFile(fullOutputPath, text, { mode: 0o600 }));
  const notice = `\n[Truncated. Full result, including any continuation cursor: ${fullOutputPath}]`;
  const bounded = truncateHead(text, {
    maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(notice),
    maxLines: DEFAULT_MAX_LINES - (notice.split("\n").length - 1),
  });
  return {
    content: [{ type: "text", text: `${bounded.content}${notice}` }],
    details: { fullOutputPath },
  };
}
