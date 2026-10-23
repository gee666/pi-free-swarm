// The slice of pi's ExtensionAPI this extension uses. pi's full API and context satisfy it; tests can
// provide a small fake instead of the whole session runtime.
import type {
  ExtensionAPI,
  ExtensionContext,
  AgentSettledEvent,
  SessionShutdownEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

export type SessionContext = Pick<ExtensionContext, "cwd" | "hasUI" | "abort" | "shutdown"> & {
  ui: Pick<ExtensionContext["ui"], "notify"> & Partial<Pick<ExtensionContext["ui"], "select">>;
};

export interface SwarmExtensionApi extends Pick<
  ExtensionAPI,
  "registerTool" | "registerFlag" | "getFlag" | "getActiveTools" | "setActiveTools"
> {
  registerCommand(
    name: string,
    command: { description: string; handler(args: string, ctx: SessionContext): Promise<void> },
  ): void;
  on(event: "session_start", handler: (event: SessionStartEvent, ctx: SessionContext) => void): unknown;
  on(event: "session_shutdown", handler: (event: SessionShutdownEvent) => void | Promise<void>): unknown;
  on(event: "agent_settled", handler: (event: AgentSettledEvent) => void): unknown;
}
