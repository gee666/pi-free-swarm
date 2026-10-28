// Factories register only; session commands can opt in even when --swarm was omitted.
import { fileURLToPath } from "node:url";
import { AGENT_ROLE, ENABLED_ENV, ENABLE_FLAG, MAIN_TOOL, ROLE_ENV } from "./src/constants.js";
import type { SessionContext, SwarmExtensionApi } from "./src/extension-api.js";
import type { MainRuntimeControl, registerMainMode } from "./src/main-runtime.js";
import { registerSessionCommands, type SessionOptions } from "./src/session-commands.js";

const extensionPath = fileURLToPath(import.meta.url);
const uiDir = fileURLToPath(new URL("./ui_dist/", import.meta.url));

export default async function piFreeSwarm(pi: SwarmExtensionApi): Promise<void> {
  if (process.env[ROLE_ENV] === AGENT_ROLE) {
    const { registerAgentMode } = await import("./src/agent-mode.js");
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
  let generation = 0;
  let enabling: { generation: number; promise: Promise<void> } | undefined;
  let mainModules: Awaited<ReturnType<typeof loadMain>> | undefined;
  const loadMain = () =>
    Promise.all([import("./src/main-runtime.js"), import("./src/server/host.js"), import("./src/tools/main-tools.js")]);
  const mainTools = Object.values(MAIN_TOOL);
  const hideTools = () =>
    pi.setActiveTools(pi.getActiveTools().filter((name) => !mainTools.some((tool) => tool === name)));
  const enable = (ctx: SessionContext): Promise<void> => {
    if (enabling?.generation === generation) return enabling.promise;
    const current = generation;
    const task = (async () => {
      // Do not traverse the server, database and runner graph for an inactive swarm.
      mainModules ??= await loadMain();
      if (current !== generation) return;
      const [main, { ServerHost }] = mainModules;
      if (!runtime) {
        runtime = main.createMainRuntime({
          cwd: ctx.cwd,
          extensionPath,
          createHost: (settings) => new ServerHost({ ...settings, uiDir }),
        });
        runtime.session = options;
        mode = main.registerMainMode(pi, runtime);
      }
      options.enabled = true;
      mode?.start(ctx);
      pi.setActiveTools([...new Set([...pi.getActiveTools(), ...mainTools])]);
    })();
    const promise = task.finally(() => {
      if (enabling?.promise === promise) enabling = undefined;
    });
    enabling = { generation: current, promise };
    return promise;
  };
  registerSessionCommands(pi, {
    options,
    enable,
    disable: async () => {
      generation++;
      options.enabled = false;
      hideTools();
      await enabling?.promise;
      await mode?.stop();
    },
    changed: () => {
      if (!runtime || !mainModules) return;
      const active = pi.getActiveTools();
      mainModules[2].registerMainTools(pi, runtime);
      pi.setActiveTools(active);
    },
  });
  pi.on("session_start", async (_event, ctx) => {
    if (options.enabled) return;
    const enabled = process.env[ENABLED_ENV];
    if (pi.getFlag(ENABLE_FLAG) === true || enabled === "1" || enabled === "true") await enable(ctx);
  });
  pi.on("session_shutdown", () => {
    generation++;
    options.enabled = false;
    hideTools();
  });
}
