import type { AgentExitInfo, AgentProcessHandlers, RpcCommand } from "../../src/agents/agent-process.js";
import type { AgentTransport, AgentTransportFactory } from "../../src/agents/transport.js";
import type { RpcRecord } from "../../src/agents/rpc-events.js";

/** Explicit commands and events let race fixtures choose their ordering without timers. */
export class FakeTransport implements AgentTransport {
  readonly commands: RpcCommand[] = [];
  readonly writes: RpcRecord[] = [];
  readonly pending: { resolve(record: RpcRecord): void; reject(error: Error): void }[] = [];
  stopped = false;
  constructor(readonly handlers: AgentProcessHandlers) {}
  send(command: RpcCommand): Promise<RpcRecord> {
    this.commands.push(command);
    return new Promise((resolve, reject) => this.pending.push({ resolve, reject }));
  }
  write(record: RpcRecord): boolean {
    this.writes.push(record);
    return !this.stopped;
  }
  respond(record: RpcRecord = { type: "response", success: true }): void {
    const pending = this.pending.shift();
    if (!pending) throw new Error("No command awaiting response.");
    pending.resolve(record);
  }
  event(record: RpcRecord): void {
    this.handlers.onEvent(record);
  }
  exit(info: Partial<AgentExitInfo> = {}): void {
    for (const pending of this.pending.splice(0)) pending.reject(new Error("Transport exited."));
    this.handlers.onExit({ code: 0, signal: null, stderrTail: "", spawnError: null, ...info });
  }
  async stop(): Promise<void> {
    if (!this.stopped) {
      this.stopped = true;
      await Promise.resolve();
      this.exit();
    }
  }
}

export function fakeTransportFactory(): { factory: AgentTransportFactory; instances: FakeTransport[] } {
  const instances: FakeTransport[] = [];
  return {
    instances,
    factory: (_spec, handlers) => {
      const transport = new FakeTransport(handlers);
      instances.push(transport);
      return transport;
    },
  };
}
