import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { SwarmDb } from "../store/db.js";
import type { ReplacementHandoff } from "./run-agent.js";

/** Runtime reads only the generated handoff subtree, never a caller-chosen source file. */
export function readReplacementHandoff(db: SwarmDb, swarmId: number, relative: string): ReplacementHandoff {
  const root = realpathSync(path.join(db.dataDir, "handoffs", String(swarmId)));
  const absolute = path.resolve(db.dataDir, relative);
  if (!lstatSync(absolute).isFile() || !realpathSync(absolute).startsWith(`${root}${path.sep}`)) {
    throw new Error("The retirement handoff must be an existing file in this swarm's handoff directory.");
  }
  const text = readFileSync(absolute, "utf8");
  if (!text.trim()) throw new Error("The retirement handoff is empty.");
  return { file: absolute, text };
}
