// Records extension registration and session behavior without a live pi process.
import type {
  AgentSettledEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import type { SessionContext, SwarmExtensionApi } from "../../src/extension-api.js";

export interface RecordedTool {
  name: string;
  description: string;
  promptSnippet: string | undefined;
  parameters: TSchema;
}

type StartHandler = (event: SessionStartEvent, ctx: SessionContext) => void;
type ShutdownHandler = (event: SessionShutdownEvent) => void | Promise<void>;
type SettledHandler = (event: AgentSettledEvent) => void;

export class FakeExtensionApi implements SwarmExtensionApi {
  readonly tools: RecordedTool[] = [];
  readonly notes: string[] = [];
  readonly commands = new Map<string, Parameters<SwarmExtensionApi["registerCommand"]>[1]>();
  readonly selectRequests: string[][] = [];
  selection: string | undefined;
  selectionResult: Promise<string | undefined> | undefined;
  private activeTools = new Set<string>();
  readonly flags = new Map<string, Parameters<SwarmExtensionApi["registerFlag"]>[1]>();
  readonly flagValues = new Map<string, boolean | string>();
  aborted = 0;
  shutdowns = 0;
  private startHandlers: StartHandler[] = [];
  private shutdownHandlers: ShutdownHandler[] = [];
  private settledHandlers: SettledHandler[] = [];

  registerTool<TParams extends TSchema, TDetails, TState>(tool: ToolDefinition<TParams, TDetails, TState>): void {
    this.activeTools.add(tool.name);
    const recorded = {
      name: tool.name,
      description: tool.description,
      promptSnippet: tool.promptSnippet,
      parameters: tool.parameters,
    };
    const existing = this.tools.findIndex((entry) => entry.name === tool.name);
    if (existing < 0) this.tools.push(recorded);
    else this.tools[existing] = recorded;
  }

  registerCommand(name: string, command: Parameters<SwarmExtensionApi["registerCommand"]>[1]): void {
    this.commands.set(name, command);
  }

  getActiveTools(): string[] {
    return [...this.activeTools];
  }

  setActiveTools(names: string[]): void {
    this.activeTools = new Set(names);
  }

  async command(name: string, args: string = "", cwd: string = process.cwd(), hasUI: boolean = true): Promise<void> {
    const command = this.commands.get(name);
    if (!command) throw new Error(`command ${name} not registered`);
    await command.handler(args, this.context(cwd, hasUI));
  }

  registerFlag(name: string, options: Parameters<SwarmExtensionApi["registerFlag"]>[1]): void {
    this.flags.set(name, options);
  }

  getFlag(name: string): boolean | string | undefined {
    return this.flagValues.get(name) ?? this.flags.get(name)?.default;
  }

  on(event: "session_start", handler: StartHandler): unknown;
  on(event: "session_shutdown", handler: ShutdownHandler): unknown;
  on(event: "agent_settled", handler: SettledHandler): unknown;
  on(
    ...[event, handler]:
      ["session_start", StartHandler] | ["session_shutdown", ShutdownHandler] | ["agent_settled", SettledHandler]
  ): unknown {
    if (event === "session_start") this.startHandlers.push(handler);
    else if (event === "session_shutdown") this.shutdownHandlers.push(handler);
    else this.settledHandlers.push(handler);
    return undefined;
  }

  toolNames(): string[] {
    return this.tools.map((tool) => tool.name);
  }

  tool(name: string): RecordedTool {
    const tool = this.tools.find((entry) => entry.name === name);
    if (tool === undefined) throw new Error(`tool ${name} not registered`);
    return tool;
  }

  private context(cwd: string, hasUI: boolean = true): SessionContext {
    return {
      cwd,
      hasUI,
      ui: {
        notify: (message) => void this.notes.push(message),
        select: async (_title, options) => {
          this.selectRequests.push(options);
          return this.selectionResult ?? this.selection;
        },
      },
      abort: () => void this.aborted++,
      shutdown: () => void this.shutdowns++,
    };
  }

  startSession(cwd: string = process.cwd()): void {
    const ctx = this.context(cwd);
    for (const handler of [...this.startHandlers]) handler({ type: "session_start", reason: "startup" }, ctx);
  }

  settleAgent(): void {
    for (const handler of this.settledHandlers) handler({ type: "agent_settled", aborted: false });
  }

  async shutdownSession(): Promise<void> {
    for (const handler of this.shutdownHandlers) await handler({ type: "session_shutdown", reason: "quit" });
  }
}
