import { createReadStream } from "node:fs";
import { createJsonlSplitter } from "./jsonl.js";
import { parseRpcLine } from "./rpc-events.js";
import type { ModelSelection } from "../runtime-types.js";

/** Reads recorded selection only; transcript text is neither retained nor returned. */
export async function readSessionModel(file: string): Promise<ModelSelection | null> {
  const selection: { model: ModelSelection | null } = { model: null };
  let thinkingLevel: string | null = null;
  const splitter = createJsonlSplitter((line) => {
    const entry = parseRpcLine(line);
    if (entry?.type === "thinking_level_change" && typeof entry.thinkingLevel === "string") {
      thinkingLevel = entry.thinkingLevel;
    }
    if (
      entry?.type === "model_change" &&
      typeof entry.provider === "string" &&
      entry.provider &&
      typeof entry.modelId === "string" &&
      entry.modelId
    ) {
      selection.model = { provider: entry.provider, modelId: entry.modelId, thinkingLevel: null };
    }
  });
  try {
    for await (const chunk of createReadStream(file)) splitter.push(chunk);
    // Ignore an incomplete final line left by a killed writer.
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  return selection.model ? { ...selection.model, thinkingLevel } : null;
}
