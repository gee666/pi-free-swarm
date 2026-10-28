import { openSwarmDb } from "../../../src/store/db.js";
import { listParticipants } from "../../../src/store/swarm-queries.js";
import { listCriteria } from "../../../src/store/criteria.js";
import { listTasks } from "../../../src/store/tasks.js";
import { getCriterionDetail } from "../../../src/broker/work-queries.js";
import { createTask } from "../../../src/broker/tasks.js";
import { claimTask } from "../../../src/broker/task-ownership.js";
import { startTask } from "../../../src/broker/task-transitions.js";
import { beginTaskReview } from "../../../src/broker/task-review.js";
import { finishReview } from "../../helpers/task-review.js";
import { recordCriterionBlocker } from "../../../src/broker/blockers.js";
import { sendMessage } from "../../../src/broker/messages.js";
import { voteCriterion } from "../../../src/broker/votes.js";

const file = process.env.PI_SWARM_DB;
const actor = process.env.PI_SWARM_AGENT;
const swarmId = Number(process.env.PI_SWARM_ID);
if (!file || !actor || !Number.isSafeInteger(swarmId)) throw new Error("Missing fixture worker identity");
const db = openSwarmDb(file, { create: false });
const input = () => ({ swarmId, actor, now: Date.now() });
const blocked = process.argv[2] === "blocked";
try {
  db.write(() => {
    const workers = listParticipants(db, swarmId).filter(
      (participant) => participant.kind === "agent" && participant.name !== "Watcher",
    );
    const implementer = workers[0]?.name === actor;
    if (implementer) {
      for (const criterion of listCriteria(db, swarmId)) {
        if (!getCriterionDetail(db, swarmId, criterion.id).tasks.length)
          createTask(db, {
            ...input(),
            title: "Verify requirement",
            body: "Implement and check the requirement",
            criteria: [{ criterionId: criterion.id, contribution: "Implementation and tests" }],
          });
      }
      for (const task of listTasks(db, swarmId)) {
        if (task.status === "new") claimTask(db, { ...input(), id: task.id });
        if (!blocked && (task.status === "new" || task.status === "claimed"))
          startTask(db, { ...input(), id: task.id });
        if (!blocked && ["new", "claimed", "in_progress"].includes(task.status)) {
          beginTaskReview(db, { ...input(), id: task.id, context: "Fixture task checks passed" });
          finishReview(db, { ...input(), id: task.id, verdict: "accept", reason: "Fixture subagent review passed" });
        }
      }
    }
    let createdBlocker = false;
    for (const criterion of listCriteria(db, swarmId)) {
      if (blocked && implementer && !getCriterionDetail(db, swarmId, criterion.id).blocker) {
        recordCriterionBlocker(db, {
          ...input(),
          criterionId: criterion.id,
          reason: "External service unavailable",
          missing: "Service credentials",
          attempted: "Checked local configuration",
          unblock: "User supplies credentials",
        });
        createdBlocker = true;
      }
      const detail = getCriterionDetail(db, swarmId, criterion.id);
      const verdict = blocked ? "blocked" : "covered";
      const voted = detail.votes.some((vote) => vote.voter === actor && !vote.stale && vote.verdict === verdict);
      const eligible = blocked ? detail.blocker !== null : detail.tasks.length > 0;
      if (!voted && eligible)
        voteCriterion(db, {
          ...input(),
          criterionId: criterion.id,
          verdict,
          reason: blocked ? "External blocker independently confirmed" : "Requirement verified",
        });
    }
    const peer = workers.find((worker) => worker.name !== actor);
    if (createdBlocker && peer)
      sendMessage(db, {
        swarmId,
        from: actor,
        to: peer.name,
        text: "Review the criterion blockers and vote independently.",
        now: Date.now(),
      });
  });
} finally {
  db.close();
}
