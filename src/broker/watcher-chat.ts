import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WatcherChatResponse } from "../api-types.js";
import { AgentSupervisor } from "../agents/supervisor.js";
import type { RpcRecord } from "../agents/rpc-events.js";
import { buildWatcherChatPrompt } from "../agents/watcher-chat-prompt.js";
import type { Clock } from "../clock.js";
import { SESSION_FILE, SESSIONS_DIR, SYSTEM_PROMPT_FILE, WATCHER_NAME } from "../constants.js";
import { checkText } from "../limits.js";
import type { SwarmDb } from "../store/db.js";
import { getSwarm } from "../store/swarm-queries.js";
import {
  appendWatcherChat,
  createWatcherChat,
  interruptWatcherChats,
  readWatcherChat,
  setWatcherChatStatus,
} from "../store/watcher-chat.js";
import { BrokerError } from "./errors.js";
import { recordAgentUsage } from "./usage-recording.js";
import { checkWatcherChatBudget, watcherChatLaunch } from "./watcher-chat-launch.js";

interface ChatProcess {
  id: string;
  cancelled: boolean;
  supervisor: AgentSupervisor | null;
  task: Promise<void> | null;
  lastError: string | null;
  hasText: boolean;
  cleanup: Promise<void>;
  stopping: Promise<void> | null;
}

export class WatcherChatConflict extends Error {}

/** Owned by one board host, never by a worker runner or a module-global registry. */
export class WatcherChatService {
  private readonly processes = new Map<number, ChatProcess>();
  private readonly operations = new Map<number, Promise<unknown>>();
  private closed = false;
  private closing: Promise<void> | null = null;

  constructor(
    private readonly db: SwarmDb,
    private readonly clock: Clock,
    private readonly onError?: (message: string) => void,
  ) {
    interruptWatcherChats(db, clock.now());
  }

  snapshot(swarmId: number): WatcherChatResponse {
    return readWatcherChat(this.db, swarmId);
  }

  send(swarmId: number, text: string, expectedSessionId?: string | null): Promise<WatcherChatResponse> {
    const checked = checkText(text, Infinity);
    if (!checked.ok) throw new BrokerError("validation", checked.error, "text");
    return this.serialize(swarmId, async () => {
      let chat = this.snapshot(swarmId);
      if (expectedSessionId !== undefined && expectedSessionId !== chat.sessionId)
        throw new WatcherChatConflict("Watcher chat changed. Refresh before sending.");
      if (chat.status === "working")
        throw new WatcherChatConflict("Watcher is still answering. Wait or start a new chat.");
      if (chat.sessionId === null) chat = this.create(swarmId);
      const id = chat.sessionId;
      if (id === null) throw new Error("Watcher session was not created.");
      let runtime = this.processes.get(swarmId);
      if (!runtime || runtime.id !== id || runtime.cancelled) {
        const cleanup = runtime ? this.stop(runtime) : Promise.resolve();
        runtime = {
          id,
          cancelled: false,
          supervisor: null,
          task: null,
          lastError: null,
          hasText: false,
          cleanup,
          stopping: null,
        };
        this.processes.set(swarmId, runtime);
      }
      runtime.lastError = null;
      runtime.hasText = false;
      this.db.write(() => {
        // Receipts precede child startup; RPC replies can also precede native session file writes.
        appendWatcherChat(this.db, swarmId, id, "user", checked.value, this.clock.now());
        this.status(swarmId, runtime, "working");
      });
      const current = runtime;
      current.task = Promise.resolve()
        .then(() => this.deliver(swarmId, current, checked.value))
        .catch((error: unknown) => this.fail(swarmId, current, error));
      return this.snapshot(swarmId);
    });
  }

  newChat(swarmId: number): Promise<WatcherChatResponse> {
    return this.serialize(swarmId, async () => {
      const previous = this.processes.get(swarmId);
      if (previous) {
        previous.cancelled = true;
        this.processes.delete(swarmId);
        await this.stop(previous);
      }
      if (this.closed) throw new Error("Board host is shutting down.");
      return this.create(swarmId);
    });
  }

  close(): Promise<void> {
    this.closed = true;
    this.closing ??= this.closeProcesses();
    return this.closing;
  }

  private async closeProcesses(): Promise<void> {
    const processes = [...this.processes.entries()];
    for (const [, runtime] of processes) runtime.cancelled = true;
    const results = await Promise.allSettled(
      processes.map(async ([swarmId, runtime]) => {
        try {
          if (this.snapshot(swarmId).status === "working")
            this.status(swarmId, runtime, "error", "Board host stopped before the Watcher response completed.");
        } finally {
          await this.stop(runtime);
          await runtime.task;
        }
      }),
    );
    await Promise.allSettled(this.operations.values());
    this.processes.clear();
    const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    if (errors.length) throw new AggregateError(errors, "Watcher chat cleanup failed.");
  }

  private serialize<T>(swarmId: number, operation: () => T | Promise<T>): Promise<T> {
    const result = (this.operations.get(swarmId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        if (this.closed) throw new Error("Board host is shutting down.");
        return operation();
      });
    this.operations.set(swarmId, result);
    void result
      .finally(() => {
        if (this.operations.get(swarmId) === result) this.operations.delete(swarmId);
      })
      .catch(() => undefined);
    return result;
  }

  private create(swarmId: number): WatcherChatResponse {
    const swarm = getSwarm(this.db, swarmId, this.clock.now());
    if (!swarm) throw new BrokerError("not_found", "Swarm not found.");
    const id = randomUUID();
    const file = this.sessionFile(swarmId, id);
    const cwd = path.resolve(this.db.dataDir, "../..");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ type: "session", version: 3, id, timestamp: new Date(this.clock.now()).toISOString(), cwd }) +
        "\n",
      { flag: "wx" },
    );
    writeFileSync(path.join(path.dirname(file), SYSTEM_PROMPT_FILE), buildWatcherChatPrompt(swarm.name));
    createWatcherChat(this.db, swarmId, id, this.clock.now());
    return this.snapshot(swarmId);
  }

  private sessionFile(swarmId: number, id: string): string {
    return path.join(this.db.dataDir, SESSIONS_DIR, String(swarmId), "watcher-chat", id, SESSION_FILE);
  }

  private live(swarmId: number, runtime: ChatProcess): boolean {
    return !this.closed && !runtime.cancelled && this.processes.get(swarmId) === runtime;
  }

  private status(
    swarmId: number,
    runtime: ChatProcess,
    status: WatcherChatResponse["status"],
    error: string | null = null,
  ): void {
    setWatcherChatStatus(this.db, swarmId, runtime.id, status, error, this.clock.now());
  }

  private fail(swarmId: number, runtime: ChatProcess, error: unknown): void {
    if (!this.live(swarmId, runtime)) return;
    const message = error instanceof Error ? error.message : String(error);
    this.status(swarmId, runtime, "error", message);
    runtime.cancelled = true;
    void this.stop(runtime).catch((cleanupError: unknown) => {
      this.onError?.(
        `Watcher chat #${swarmId} cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
      );
    });
    this.onError?.(`Watcher chat #${swarmId}: ${message}`);
  }

  private stop(runtime: ChatProcess): Promise<void> {
    runtime.stopping ??= Promise.all([runtime.cleanup, runtime.supervisor?.stop()]).then(() => undefined);
    return runtime.stopping;
  }

  private message(swarmId: number, runtime: ChatProcess, message: RpcRecord): void {
    if (!this.live(swarmId, runtime) || message.role !== "assistant") return;
    runtime.lastError =
      message.stopReason === "error" || message.stopReason === "aborted"
        ? typeof message.errorMessage === "string"
          ? message.errorMessage
          : "Watcher model call failed."
        : null;
    if (message.stopReason !== "stop") return;
    const content = message.content;
    if (!Array.isArray(content)) return;
    const texts: string[] = [];
    for (const block of content) {
      if (
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      )
        texts.push(block.text);
    }
    const text = texts.join("\n");
    if (text.trim()) {
      runtime.hasText = true;
      appendWatcherChat(this.db, swarmId, runtime.id, "assistant", text, this.clock.now());
    }
  }

  private async deliver(swarmId: number, runtime: ChatProcess, text: string): Promise<void> {
    await runtime.cleanup;
    if (!this.live(swarmId, runtime)) return;
    checkWatcherChatBudget(this.db, swarmId, this.clock.now());
    const prompt = {
      text,
      messageIds: [],
      beforeSend: () => (this.live(swarmId, runtime) ? { text, messageIds: [] } : null),
    };
    let supervisor = runtime.supervisor;
    if (!supervisor) {
      const launch = await watcherChatLaunch(this.db, swarmId, this.sessionFile(swarmId, runtime.id), this.clock.now());
      if (!this.live(swarmId, runtime)) return;
      const guard = (action: () => void) => {
        try {
          action();
        } catch (error) {
          this.fail(swarmId, runtime, error);
        }
      };
      supervisor = new AgentSupervisor({
        name: WATCHER_NAME,
        clock: this.clock,
        watchdog: launch.watchdog,
        hooks: {
          onStatus: (status) =>
            guard(() => {
              if (this.live(swarmId, runtime) && status === "idle") {
                const error = runtime.lastError ?? (runtime.hasText ? null : "Watcher returned no text.");
                this.status(swarmId, runtime, error ? "error" : "idle", error);
              }
            }),
          onActivity: () => undefined,
          onMessagesRead: () => undefined,
          onMessage: (message) => guard(() => this.message(swarmId, runtime, message)),
          onUsage: (sample) => {
            try {
              // Closing generations still owe usage, but cannot publish chat text or worker status.
              recordAgentUsage(this.db, swarmId, WATCHER_NAME, sample, this.clock.now(), launch.run, false);
              if (this.live(swarmId, runtime)) checkWatcherChatBudget(this.db, swarmId, this.clock.now());
            } catch (error) {
              if (this.live(swarmId, runtime)) this.fail(swarmId, runtime, error);
              else this.onError?.(`Watcher chat usage: ${error instanceof Error ? error.message : String(error)}`);
            }
          },
          onCrash: (crash) => this.fail(swarmId, runtime, crash.message),
        },
      });
      runtime.supervisor = supervisor;
      const outcome = await supervisor.launch(launch.spec, prompt);
      if (!outcome.accepted) this.fail(swarmId, runtime, outcome.error);
    } else {
      const outcome = await supervisor.deliver(prompt);
      if (!outcome.accepted) this.fail(swarmId, runtime, outcome.error);
    }
  }
}
