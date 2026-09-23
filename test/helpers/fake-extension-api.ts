// A stand-in for pi's ExtensionAPI: records tools and the two session handlers the extension uses.
import type { SessionShutdownEvent, SessionStartEvent, ToolDefinition } from "@earendil-works/pi-coding-agent";
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

export class FakeExtensionApi implements SwarmExtensionApi {
  readonly tools: RecordedTool[] = [];
  readonly notes: string[] = [];
  aborted = 0;
  shutdowns = 0;
  private startHandlers: StartHandler[] = [];
  private shutdownHandlers: ShutdownHandler[] = [];

  registerTool<TParams extends TSchema, TDetails, TState>(tool: ToolDefinition<TParams, TDetails, TState>): void {
    this.tools.push({
      name: tool.name,
      description: tool.description,
      promptSnippet: tool.promptSnippet,
      parameters: tool.parameters,
    });
  }

  on(event: "session_start", handler: StartHandler): unknown;
  on(event: "session_shutdown", handler: ShutdownHandler): unknown;
  on(...[event, handler]: ["session_start", StartHandler] | ["session_shutdown", ShutdownHandler]): unknown {
    if (event === "session_start") this.startHandlers.push(handler);
    else this.shutdownHandlers.push(handler);
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

  startSession(): void {
    const ctx: SessionContext = {
      hasUI: true,
      ui: { notify: (message) => void this.notes.push(message) },
      abort: () => void this.aborted++,
      shutdown: () => void this.shutdowns++,
    };
    for (const handler of this.startHandlers) handler({ type: "session_start", reason: "startup" }, ctx);
  }

  async shutdownSession(): Promise<void> {
    for (const handler of this.shutdownHandlers) await handler({ type: "session_shutdown", reason: "quit" });
  }
}
