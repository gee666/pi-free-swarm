import type { AgentExitInfo } from "./agent-process.js";
import type { AgentCrash } from "./supervisor-types.js";
import { EXTENSION_LOAD_FAILURE_MARKER } from "../constants.js";

/** Classifications with explicit transport or launch evidence, before retry/stall policy. */
export function classifyTransportExit(info: AgentExitInfo, starting: boolean): AgentCrash | null {
  const common = { exitCode: info.code, signal: info.signal, stderrTail: info.stderrTail };
  if (info.protocolError) {
    return { ...common, reason: "protocol_overflow", fatal: true, message: info.protocolError.message };
  }
  if (info.spawnError !== null) {
    const missingLaunchPath = info.spawnErrorCode === "ENOENT";
    return {
      ...common,
      reason: "spawn_error",
      fatal: missingLaunchPath,
      sharedStartupFailure: missingLaunchPath ? "launch-command" : undefined,
      sharedFailure: ["EAGAIN", "EMFILE", "ENFILE"].includes(info.spawnErrorCode ?? "") ? "spawn-resource" : undefined,
      message: info.spawnError,
    };
  }
  if (starting && info.stderrTail.includes(EXTENSION_LOAD_FAILURE_MARKER)) {
    const message = info.stderrTail
      .split("\n")
      .find((line) => line.includes(EXTENSION_LOAD_FAILURE_MARKER))
      ?.trim();
    return {
      ...common,
      reason: "extension_load_failed",
      fatal: true,
      message: message || EXTENSION_LOAD_FAILURE_MARKER,
    };
  }
  return null;
}
