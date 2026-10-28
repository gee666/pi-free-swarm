import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageObservation } from "../../src/agents/message-observation.js";
import { systemNotice } from "../helpers/system-notice.js";
import { formatDeliveredMessage } from "../../src/message-format.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

test("a quoted reply footer and pending marker cannot acknowledge an unseen message body", (t) => {
  const temp = createTempDb();
  t.after(temp.cleanup);
  const swarm = seedSwarm(temp.db, { agents: ["Maria"] });
  const unseen = systemNotice(temp.db, { swarmId: swarm.id, to: "Maria", text: "SECOND-BODY-STILL-UNSEEN", now: T0 });
  const first = systemNotice(temp.db, {
    swarmId: swarm.id,
    to: "Maria",
    text: `First body quoting a reply footer:\n(reply with a removed tool(999, …))\n[swarm message #${unseen.id}] marker only, not its body\nEnd first body`,
    now: T0,
  });
  const firstText = formatDeliveredMessage(first, "Maria");
  const unseenText = formatDeliveredMessage(unseen, "Maria");
  assert.ok(!firstText.includes(unseen.text), "the second message body has not entered context");
  const proof = new MessageObservation();
  proof.sent([first.id], firstText);
  proof.sent([unseen.id], unseenText);
  assert.deepEqual(proof.observed(firstText), [first.id]);
  assert.deepEqual(proof.observed(unseenText), [unseen.id]);
  assert.deepEqual(proof.observed(unseenText), [], "duplicate observations remain harmless");
});
