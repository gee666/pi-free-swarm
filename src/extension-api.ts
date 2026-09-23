// The slice of pi's ExtensionAPI this extension uses. pi's full API and context satisfy it; tests can
// provide a small fake instead of the whole session runtime.
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionShutdownEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

export type SessionContext = Pick<ExtensionContext, "hasUI" | "abort" | "shutdown"> & {
  ui: Pick<ExtensionContext["ui"], "notify">;
};

export interface SwarmExtensionApi extends Pick<ExtensionAPI, "registerTool"> {
  on(event: "session_start", handler: (event: SessionStartEvent, ctx: SessionContext) => void): unknown;
  on(event: "session_shutdown", handler: (event: SessionShutdownEvent) => void | Promise<void>): unknown;
}
