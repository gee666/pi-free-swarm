import type { SessionContext, SwarmExtensionApi } from "./extension-api.js";
import { loadSettings, type SwarmSettings } from "./settings.js";
import { saveSessionSettings, settingsForDisplay } from "./settings-persistence.js";

export interface SessionOptions {
  enabled: boolean;
  maxAgents?: number;
}

export interface SessionCommands {
  options: SessionOptions;
  enable(ctx: SessionContext): void;
  disable(): Promise<void>;
  changed?(): void;
}

export function applySessionOptions(settings: SwarmSettings, options: SessionOptions | undefined): SwarmSettings {
  if (options?.maxAgents === undefined) return settings;
  if (options.maxAgents < settings.minAgents)
    throw new Error(
      `Session max-agents (${options.maxAgents}) is below configured minAgents (${settings.minAgents}); update /swarm:max-agents.`,
    );
  return {
    ...settings,
    maxAgents: options.maxAgents,
    defaultAgents: Math.min(settings.defaultAgents, options.maxAgents),
  };
}

/** Commands remain available without CLI opt-in. Only explicit save writes settings. */
export function registerSessionCommands(pi: SwarmExtensionApi, controls: SessionCommands): void {
  let pending: Promise<void> = Promise.resolve();
  let generation = 0;
  pi.on("session_shutdown", () => {
    generation++;
    pending = Promise.resolve();
    controls.options.enabled = false;
    delete controls.options.maxAgents;
  });
  const command = (
    name: string,
    description: string,
    action: (args: string, ctx: SessionContext) => void | Promise<void>,
  ) => {
    pi.registerCommand(name, {
      description,
      handler(args, ctx) {
        const current = generation;
        const result = pending.then(async () => {
          if (current !== generation) return;
          try {
            await action(args.trim(), ctx);
          } catch (error) {
            ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
          }
        });
        pending = result;
        return result;
      },
    });
  };
  command("swarm:enable", "Enable swarm tools and board for this session only", (args, ctx) => {
    if (args) throw new Error("Usage: /swarm:enable");
    controls.enable(ctx);
    ctx.ui.notify("Swarm enabled for this session.", "info");
  });
  command(
    "swarm:disable",
    "Stop session-owned swarms and board, and disable swarm tools for this session",
    async (args, ctx) => {
      if (args) throw new Error("Usage: /swarm:disable");
      ctx.ui.notify(
        "Disabling swarm: stopping this session's active swarm work and board. Pending communication is preserved.",
        "info",
      );
      await controls.disable();
      ctx.ui.notify("Swarm disabled for this session.", "info");
    },
  );
  command("swarm:max-agents", "Set the maximum for future swarm launches in this session only", (args, ctx) => {
    if (!/^[1-9]\d*$/.test(args) || !Number.isSafeInteger(Number(args)))
      throw new Error("Usage: /swarm:max-agents <positive integer>");
    const maximum = Number(args);
    const { settings } = loadSettings(ctx.cwd);
    if (maximum < settings.minAgents)
      throw new Error(`max-agents must be at least configured minAgents (${settings.minAgents}).`);
    controls.options.maxAgents = maximum;
    controls.changed?.();
    ctx.ui.notify(
      `Session swarm maximum is ${maximum}. Future launches only; active teams and settings.json are unchanged.`,
      "info",
    );
  });
  command("swarm:settings", "Show effective swarm settings with environment values redacted", (args, ctx) => {
    if (args) throw new Error("Usage: /swarm:settings");
    const settings = applySessionOptions(loadSettings(ctx.cwd).settings, controls.options);
    ctx.ui.notify(
      JSON.stringify(
        {
          enabled: controls.options.enabled,
          sessionOverrides: { maxAgents: controls.options.maxAgents ?? null },
          ...settingsForDisplay(settings),
        },
        null,
        2,
      ),
      "info",
    );
  });
  command(
    "swarm:save-settings",
    "Save nonsecret effective settings to project or global scope explicitly",
    async (args, ctx) => {
      const current = generation;
      const target =
        args ||
        (ctx.hasUI && ctx.ui.select ? await ctx.ui.select("Save swarm settings", ["project", "global"]) : undefined);
      if (current !== generation) return;
      if (target === undefined && ctx.hasUI && ctx.ui.select) return;
      if (target !== "project" && target !== "global") throw new Error("Usage: /swarm:save-settings project|global");
      const settings = applySessionOptions(loadSettings(ctx.cwd).settings, controls.options);
      const destination = saveSessionSettings(ctx.cwd, settings, target);
      ctx.ui.notify(
        `Saved swarm settings to ${destination}. Environment values were not copied; existing destination env is preserved. Enabled remains session-only.`,
        "info",
      );
    },
  );
}
