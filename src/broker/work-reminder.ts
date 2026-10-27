import type { SwarmDb } from "../store/db.js";
import { workDashboard } from "./work-queries.js";

export function workReminder(db: SwarmDb, swarmId: number, actor: string, now: number): string {
  const dashboard = workDashboard(db, swarmId, now, actor);
  return [
    ...dashboard.completion.gates
      .filter((gate) => !gate.ok)
      .map((gate) => `${gate.key} (${gate.count}): ${gate.detail}`),
    "Own queue:",
    ...dashboard.queue.tasks.map((task) => `#${task.id} [${task.status}] ${task.title}`),
    `Reviews: ${dashboard.queue.reviews.map((task) => `#${task.id}`).join(", ") || "none"}`,
    `Votes needed: ${dashboard.queue.criteria.map((criterion) => `#${criterion.id}`).join(", ") || "none"}`,
    "Runnable unclaimed:",
    ...dashboard.runnable.map((task) => `#${task.id} ${task.title}`),
    `Unlinked criteria: ${dashboard.counts.unlinked}`,
  ].join("\n");
}
