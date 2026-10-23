// Factories register only; session commands can opt in even when --swarm was omitted.
import { fileURLToPath } from "node:url";
import { AGENT_ROLE, ENABLED_ENV, ENABLE_FLAG, MAIN_TOOL, ROLE_ENV } from "./src/constants.js";
import { registerAgentMode } from "./src/agent-mode.js";
import type { SessionContext, SwarmExtensionApi } from "./src/extension-api.js";
import { createMainRuntime, registerMainMode, type MainRuntimeControl } from "./src/main-runtime.js";
import { registerSessionCommands, type SessionOptions } from "./src/session-commands.js";
import { registerMainTools } from "./src/tools/main-tools.js";
import { ServerHost } from "./src/server/host.js";

const extensionPath = fileURLToPath(import.meta.url);
const uiDir = fileURLToPath(new URL("./ui_dist/", import.meta.url));

export default function piFreeSwarm(pi: SwarmExtensionApi): void {
  if (process.env[ROLE_ENV] === AGENT_ROLE) {
    registerAgentMode(pi, process.env);
    return;
  }
  pi.registerFlag(ENABLE_FLAG, {
    description: "Enable swarm tools and the project's swarm board",
    type: "boolean",
    default: false,
  });
  const options: SessionOptions = { enabled: false };
  let runtime: MainRuntimeControl | undefined;
  let mode: ReturnType<typeof registerMainMode> | undefined;
  const mainTools = Object.values(MAIN_TOOL);
  const hideTools = () =>
    pi.setActiveTools(pi.getActiveTools().filter((name) => !mainTools.some((tool) => tool === name)));
  const enable = (ctx: SessionContext) => {
    options.enabled = true;
    if (!runtime) {
      runtime = createMainRuntime({
        cwd: ctx.cwd,
        extensionPath,
        createHost: (settings) => new ServerHost({ ...settings, uiDir }),
      });
      runtime.session = options;
      mode = registerMainMode(pi, runtime, ctx);
    } else mode?.start(ctx);
    pi.setActiveTools([...new Set([...pi.getActiveTools(), ...mainTools])]);
  };
  registerSessionCommands(pi, {
    options,
    enable,
    disable: async () => {
      options.enabled = false;
      hideTools();
      await mode?.stop();
    },
    changed: () => {
      if (!runtime) return;
      const active = pi.getActiveTools();
      registerMainTools(pi, runtime);
      pi.setActiveTools(active);
    },
  });
  pi.on("session_start", (_event, ctx) => {
    if (options.enabled) return;
    const enabled = process.env[ENABLED_ENV];
    if (pi.getFlag(ENABLE_FLAG) === true || enabled === "1" || enabled === "true") enable(ctx);
  });
  pi.on("session_shutdown", () => hideTools());
}
