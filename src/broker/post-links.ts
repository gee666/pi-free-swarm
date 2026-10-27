import type { SwarmDb } from "../store/db.js";
import { changePostLink, listPostLinks, type PostLink } from "../store/post-links.js";
import { postExists } from "../store/wall-queries.js";
import { insertEvent } from "../store/events.js";
import { BrokerError } from "./errors.js";
import { notifyWork } from "./work-notifications.js";
import { requireCriterion, requireTask, type WorkInput } from "./work-validation.js";
import { writeWork } from "./work-write.js";

export function updatePostLinks(
  db: SwarmDb,
  input: WorkInput & {
    postId: number;
    taskIds?: readonly number[];
    criterionIds?: readonly number[];
    remove?: boolean;
  },
): { id: number; links: PostLink[] } {
  return writeWork(db, input, () => {
    if (!postExists(db, input.swarmId, input.postId))
      throw new BrokerError("not_found", `Post #${input.postId} not found.`);
    let changed = false;
    const notified = new Set<string>();
    for (const id of new Set(input.taskIds ?? [])) {
      const task = requireTask(db, input.swarmId, id);
      if (!changePostLink(db, { postId: input.postId, targetKind: "task", targetId: id }, input.remove ?? false))
        continue;
      changed = true;
      if (!input.remove && task.owner !== null && !notified.has(task.owner)) {
        notifyWork(
          db,
          input.swarmId,
          task.owner,
          `Post #${input.postId} linked to task #${id}. Call swarm_posts_get.`,
          input.now,
        );
        notified.add(task.owner);
      }
    }
    for (const id of new Set(input.criterionIds ?? [])) {
      requireCriterion(db, input.swarmId, id, input.remove);
      changed =
        changePostLink(db, { postId: input.postId, targetKind: "criterion", targetId: id }, input.remove ?? false) ||
        changed;
    }
    if (changed) insertEvent(db, input.swarmId, "post.links.changed", { id: input.postId }, input.now);
    return { id: input.postId, links: listPostLinks(db, input.postId) };
  });
}
