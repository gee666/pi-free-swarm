import type { PromptPayload } from "../agents/supervisor.js";
import { SYSTEM_NAME } from "../constants.js";
import { retiringWorkers } from "../store/retirement.js";
import { formatNotificationMessages } from "./notification-format.js";
import type { SwarmDb } from "../store/db.js";
import { getMessages } from "../store/message-queries.js";

/** Recheck cancellations at the actual transport boundary, after serialized sends have waited. */
export function messagePrompt(
  db: SwarmDb,
  swarmId: number,
  name: string,
  messageIds: readonly number[],
  render: (messages: string) => string | null = (messages) => messages || null,
  onError?: (error: unknown) => void,
): PromptPayload | null {
  const refresh = (): PromptPayload | null => {
    const retiring = retiringWorkers(db, swarmId).has(name);
    const messages = getMessages(db, messageIds).filter(
      (message) =>
        message.swarmId === swarmId &&
        !(retiring && message.sender === SYSTEM_NAME) &&
        message.recipients.some(
          (recipient) =>
            recipient.name === name && (recipient.status === "pending" || recipient.status === "delivered"),
        ),
    );
    const text = render(formatNotificationMessages(db, messages, name));
    return text === null ? null : { text, messageIds: messages.map((message) => message.id) };
  };
  const initial = refresh();
  return initial === null
    ? null
    : {
        ...initial,
        beforeSend: () => {
          try {
            return refresh();
          } catch (error) {
            if (!onError) throw error;
            onError(error);
            return null;
          }
        },
      };
}
