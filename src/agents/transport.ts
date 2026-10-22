import { AgentProcess, type AgentProcessHandlers, type RpcCommand } from "./agent-process.js";
import type { Clock } from "../clock.js";
import type { AgentLaunchSpec } from "./launch.js";
import type { RpcRecord } from "./rpc-events.js";

/** The supervisor owns policy; the transport owns process and protocol resources. */
export interface AgentTransport {
  send(command: RpcCommand): Promise<RpcRecord>;
  write(record: RpcRecord): boolean;
  stop(): Promise<void>;
}

// Callbacks must be asynchronous, as with the real child process adapter.
export type AgentTransportFactory = (
  spec: AgentLaunchSpec,
  handlers: AgentProcessHandlers,
  clock: Clock,
) => AgentTransport;

export const spawnAgentTransport: AgentTransportFactory = (spec, handlers, clock) =>
  AgentProcess.spawn(spec, handlers, clock);
