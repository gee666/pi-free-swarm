// pi-free-swarm entry. PI_SWARM_ROLE decides the role: `ctx.mode === "rpc"` is also true for IDE clients,
// so only our own variable marks a swarm agent. The factory only registers; work starts on session_start.
import { fileURLToPath } from "node:url";
import { AGENT_ROLE, ROLE_ENV } from "./src/constants.js";
import { registerAgentMode } from "./src/agent-mode.js";
import type { SwarmExtensionApi } from "./src/extension-api.js";
import { createMainRuntime, registerMainMode } from "./src/main-runtime.js";
import { ServerHost } from "./src/server/host.js";

const extensionPath = fileURLToPath(import.meta.url);
const uiDir = fileURLToPath(new URL("./ui_dist/", import.meta.url));

export default function piFreeSwarm(pi: SwarmExtensionApi): void {
  if (process.env[ROLE_ENV] === AGENT_ROLE) {
    registerAgentMode(pi, process.env);
    return;
  }
  const runtime = createMainRuntime({
    cwd: process.cwd(),
    extensionPath,
    createHost: (options) => new ServerHost({ ...options, uiDir }),
  });
  registerMainMode(pi, runtime);
}
