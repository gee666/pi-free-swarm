import { MAIN_FEEDBACK_POST_SUFFIX, MAIN_FEEDBACK_POST_TITLE, MAIN_NAME } from "../constants.js";
import { clipWithSuffix, MAIN_FEEDBACK_MAX, WORK_TEXT_ACCEPTED } from "../limits.js";
import type { SwarmDb } from "../store/db.js";
import { workRoster } from "../store/work-roster.js";
import { createPost } from "./wall.js";
import { notifyWork } from "./work-notifications.js";
import { notifyLocalMessage } from "./notify.js";
import { requireSwarm, requireText } from "./validate.js";

export function feedbackPostBody(feedback: string, max: number): string {
  return clipWithSuffix(feedback, MAIN_FEEDBACK_POST_SUFFIX, max);
}

export function sendMainFeedback(db: SwarmDb, swarmId: number, text: string, now: number, instructions = ""): void {
  db.write(() => {
    requireSwarm(db, swarmId);
    const value = requireText(text, MAIN_FEEDBACK_MAX, "feedback");
    createPost(
      db,
      swarmId,
      MAIN_NAME,
      {
        title: MAIN_FEEDBACK_POST_TITLE,
        text: feedbackPostBody(value, WORK_TEXT_ACCEPTED),
      },
      now,
    );
    for (const agent of workRoster(db, swarmId).filter((agent) => agent.active)) {
      notifyWork(db, swarmId, agent.name, instructions ? `${value}\n\n${instructions}` : value, now);
    }
    db.afterCommit(() => notifyLocalMessage(swarmId));
  });
}
