// Broker failures with a stable code; the message is shown verbatim to agents and in API error bodies.

export type BrokerErrorCode = "validation" | "not_found" | "not_member" | "swarm_running";

export class BrokerError extends Error {
  constructor(
    readonly code: BrokerErrorCode,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "BrokerError";
  }
}
