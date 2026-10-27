import type { SwarmDb } from "../store/db.js";
import { insertEvent } from "../store/events.js";
import { assessCriteria, type CriterionAssessment } from "./criterion-status.js";
import { notifyLocalMessage } from "./notify.js";
import { notifyVoteNeeded, notifyWork } from "./work-notifications.js";
import { workActor, type WorkInput } from "./work-validation.js";

type WorkListener = (swarmId: number) => void;
const listeners = new Set<WorkListener>();
export function onWorkChanged(listener: WorkListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function snapshot(db: SwarmDb, swarmId: number): Map<number, CriterionAssessment> {
  return new Map(assessCriteria(db, swarmId, true).map((criterion) => [criterion.id, criterion]));
}
export function writeWork<T>(db: SwarmDb, input: WorkInput, mutate: (actor: string) => T): T {
  const result = db.write(() => {
    const actor = workActor(db, input);
    const before = snapshot(db, input.swarmId);
    const result = mutate(actor);
    const after = snapshot(db, input.swarmId);
    for (const [id, state] of after) {
      const old = before.get(id);
      if (JSON.stringify(old) === JSON.stringify(state)) continue;
      insertEvent(db, input.swarmId, "criterion.changed", { id }, input.now);
      for (const vote of state.votes.filter(
        (vote) => vote.stale && old?.votes.some((previous) => previous.voter === vote.voter && !previous.stale),
      )) {
        notifyWork(
          db,
          input.swarmId,
          vote.voter,
          `Vote on criterion #${id} is stale. Call swarm_criteria_get then swarm_criteria_vote.`,
          input.now,
        );
      }
      if (
        state.taskCount > 0 &&
        state.unacceptedCount === 0 &&
        (old === undefined || old.taskCount === 0 || old.unacceptedCount > 0)
      ) {
        notifyVoteNeeded(db, input.swarmId, id, input.now);
      }
    }
    db.afterCommit(() => {
      notifyLocalMessage(input.swarmId);
      for (const listener of listeners) listener(input.swarmId);
    });
    return result;
  });
  return result;
}
