import path from "node:path";
import { runReviewProcess, type ReviewProcessResult } from "../agents/review-process.js";
import { systemClock, type Clock } from "../clock.js";
import type { ModelSelection } from "../runtime-types.js";
import type { SwarmDb } from "../store/db.js";
import { attachReviewer, beginTaskReview, finishTaskReview, type ReviewInput } from "./task-review.js";
import { recordAgentUsage } from "./usage-recording.js";

export async function reviewTask(
  db: SwarmDb,
  input: ReviewInput,
  options: { model: ModelSelection; modelPricingKnown?: boolean; signal?: AbortSignal; clock?: Clock },
): Promise<string> {
  const clock = options.clock ?? systemClock;
  const review = beginTaskReview(db, input);
  let result: ReviewProcessResult;
  try {
    result = await runReviewProcess({
      ...options,
      cwd: path.resolve(db.dataDir, "../.."),
      sessionFile: review.sessionFile,
      revision: review.task.revision,
      resume: input.resume,
      prompt: review.prompt,
      onSpawn: (pid) => attachReviewer(db, input.id, review.task.revision, pid),
      onUsage: (sample) =>
        recordAgentUsage(db, input.swarmId, input.actor, sample, clock.now(), input.run, options.modelPricingKnown),
    });
  } catch (error) {
    const reason = `Review failed: ${error instanceof Error ? error.message : String(error)}`;
    finishTaskReview(db, { ...input, now: clock.now(), revision: review.task.revision, verdict: null, reason });
    throw error;
  }
  const task = finishTaskReview(db, {
    ...input,
    now: clock.now(),
    revision: review.task.revision,
    verdict: result.verdict,
    reason: result.findings,
  });
  return `Task #${task.id} [${task.status}].\n${result.findings}`;
}
