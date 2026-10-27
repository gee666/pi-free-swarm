import type { MessageObservation } from "./message-observation.js";
import type { AgentTransport } from "./transport.js";

/** A confirmed queue clear cancels unsent proofs; a settled event does not. */
export async function clearSteeringQueue(transport: AgentTransport, messages: MessageObservation): Promise<boolean> {
  const response = await transport.send({ type: "clear_queue" });
  if (response.success !== true) return false;
  const cancelled = new Map<string, number>();
  if (typeof response.data === "object" && response.data !== null) {
    for (const field of ["steering", "followUp"]) {
      const queue: unknown = Reflect.get(response.data, field);
      if (Array.isArray(queue)) {
        for (const text of queue) {
          if (typeof text === "string") cancelled.set(text, (cancelled.get(text) ?? 0) + 1);
        }
      }
    }
  }
  messages.cancelQueued(cancelled);
  return true;
}
