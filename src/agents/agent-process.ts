// One spawned `pi --mode rpc` child: JSONL framing, command/response correlation, stderr tail, stop.
import type { ChildProcess } from "node:child_process";
import { systemClock, type Clock, type TimerHandle } from "../clock.js";
import { MAX_CAPTURED_STDERR_CHARS, SIGKILL_TIMEOUT_MS } from "../constants.js";
import { spawnAgentProcess, stopProcessTree, type AgentLaunchSpec } from "./launch.js";
import { isAgentGroupAlive, unregisterAgentProcess } from "./process-registry.js";
import { createJsonlSplitter, parseRpcLine, type RpcRecord } from "./rpc-events.js";

export interface AgentExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
  /** Set when the child could not be spawned at all (e.g. the command does not exist). */
  spawnError: string | null;
}

export interface AgentProcessHandlers {
  onEvent(event: RpcRecord): void;
  onExit(info: AgentExitInfo): void;
}

export type RpcCommand = { type: string } & Record<string, unknown>;

const GROUP_CHECK_INTERVAL_MS = 50;

interface PendingCommand {
  resolve(response: RpcRecord): void;
  reject(error: Error): void;
}

export class AgentProcess {
  readonly #child: ChildProcess;
  readonly #handlers: AgentProcessHandlers;
  readonly #clock: Clock;
  readonly #pending = new Map<string, PendingCommand>();
  readonly #exitWaiters: (() => void)[] = [];
  #nextId = 0;
  #stderr = "";
  #exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  #groupTimer: TimerHandle | undefined;
  #closed = false;
  #forced = false;
  #killTimer: TimerHandle | undefined;
  #finished = false;

  private constructor(child: ChildProcess, handlers: AgentProcessHandlers, clock: Clock) {
    this.#child = child;
    this.#handlers = handlers;
    this.#clock = clock;
    this.#attach();
  }

  static spawn(spec: AgentLaunchSpec, handlers: AgentProcessHandlers, clock: Clock = systemClock): AgentProcess {
    return new AgentProcess(spawnAgentProcess(spec), handlers, clock);
  }

  get pid(): number | undefined {
    return this.#child.pid;
  }

  /** Writes a command with a unique id; resolves with its `response` record; rejects if the child exits first. */
  send(command: RpcCommand): Promise<RpcRecord> {
    const id = `swarm-${++this.#nextId}`;
    return new Promise((resolve, reject) => {
      if (this.#finished || !this.write({ ...command, id })) {
        reject(new Error("Agent process is not accepting commands."));
        return;
      }
      this.#pending.set(id, { resolve, reject });
    });
  }

  /** Fire-and-forget record without a response. false when stdin is closed. */
  write(record: RpcRecord): boolean {
    const stdin = this.#child.stdin;
    if (!stdin?.writable) return false;
    stdin.write(`${JSON.stringify(record)}\n`);
    return true;
  }

  /** SIGTERM then SIGKILL after SIGKILL_TIMEOUT_MS; resolves after the process group is gone. */
  stop(): Promise<void> {
    if (this.#finished) return Promise.resolve();
    const exited = new Promise<void>((resolve) => this.#exitWaiters.push(resolve));
    this.#beginCleanup();
    return exited;
  }

  #attach(): void {
    const child = this.#child;
    const splitter = createJsonlSplitter((line) => this.#onLine(line));
    child.stdout?.on("data", (chunk: Buffer) => splitter.push(chunk));
    child.stdout?.on("end", () => splitter.end());
    child.stderr?.on("data", (chunk: Buffer) => {
      this.#stderr = (this.#stderr + chunk.toString()).slice(-MAX_CAPTURED_STDERR_CHARS);
    });
    // EPIPE after the child died: the exit path reports it.
    child.stdin?.on("error", () => undefined);
    child.on("error", (error) => {
      if (child.pid === undefined) this.#finish({ code: null, signal: null }, error.message);
    });
    child.on("exit", (code, signal) => {
      this.#exit = { code, signal };
      // Leader exit is not group exit: descendants may ignore TERM and detach their stdio.
      if (!this.#finished) this.#beginCleanup();
    });
    child.on("close", (code, signal) => {
      this.#closed = true;
      this.#exit ??= { code, signal };
      this.#checkCleanup();
    });
  }

  #beginCleanup(): void {
    if (this.#killTimer) return;
    stopProcessTree(this.#child, false);
    this.#killTimer = this.#clock.after(SIGKILL_TIMEOUT_MS, () => this.#escalate());
    this.#groupTimer = this.#clock.every(GROUP_CHECK_INTERVAL_MS, () => this.#checkCleanup());
  }

  #checkCleanup(): void {
    if (this.#finished || (!this.#closed && !this.#forced)) return;
    if (!isAgentGroupAlive(this.#child)) {
      this.#finish(this.#exit ?? { code: null, signal: "SIGKILL" }, null);
    }
  }

  #onLine(line: string): void {
    const record = parseRpcLine(line);
    if (!record) return;
    if (record.type === "response" && typeof record.id === "string") {
      const pending = this.#pending.get(record.id);
      if (pending) {
        this.#pending.delete(record.id);
        pending.resolve(record);
      }
      return;
    }
    this.#handlers.onEvent(record);
  }

  #escalate(): void {
    if (this.#finished) return;
    this.#forced = true;
    stopProcessTree(this.#child, true);
    this.#child.stdin?.destroy();
    this.#child.stdout?.destroy();
    this.#child.stderr?.destroy();
    this.#checkCleanup();
  }

  #finish(exit: { code: number | null; signal: NodeJS.Signals | null }, spawnError: string | null): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#groupTimer?.cancel();
    unregisterAgentProcess(this.#child);
    this.#killTimer?.cancel();
    const error = new Error("Agent process exited before answering.");
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.#handlers.onExit({ ...exit, stderrTail: this.#stderr, spawnError });
    for (const resolve of this.#exitWaiters.splice(0)) resolve();
  }
}
