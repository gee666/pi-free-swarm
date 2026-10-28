import { insertSystemNotice } from "../../src/broker/message-insert.js";
import { notifyLocalMessage } from "../../src/broker/notify.js";
import type { SwarmDb } from "../../src/store/db.js";

export function systemNotice(db: SwarmDb, input: { swarmId: number; to: string; text: string; now: number }) {
  return db.write(() => {
    const notice = insertSystemNotice(db, {
      swarmId: input.swarmId,
      recipient: input.to,
      text: input.text,
      now: input.now,
    });
    db.afterCommit(() => notifyLocalMessage(input.swarmId));
    return notice;
  });
}
