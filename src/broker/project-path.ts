import path from "node:path";

export function projectOf(dataDir: string): string {
  return path.resolve(dataDir, "../..");
}
