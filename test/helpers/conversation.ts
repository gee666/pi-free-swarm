import { sendMessage } from "../../src/broker/messages.js";
import { getThreadView } from "../../src/store/message-queries.js";
import type { SwarmDb } from "../../src/store/db.js";

export function continueConversation(
  db: SwarmDb,
  swarmId: number,
  from: string,
  threadId: number,
  text: string,
  now: number,
) {
  const thread = getThreadView(db, swarmId, threadId);
  const peer = thread?.members.find((name) => name !== from);
  if (!peer) throw new Error("Conversation peer missing");
  return sendMessage(db, { swarmId, from, to: peer, text, now });
}
