import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("startup-probe", {
    baseUrl: "http://127.0.0.1:1",
    api: "openai-completions",
    apiKey: "unused-local-test-key",
    models: [
      {
        id: "probe",
        name: "Startup probe",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 1024,
      },
    ],
  });
  const snapshot = () => {
    const tools = pi
      .getAllTools()
      .filter(
        (tool) =>
          tool.name === "swarm" ||
          tool.name === "resume_swarm" ||
          tool.name === "restart_swarm" ||
          tool.name.startsWith("swarm_"),
      )
      .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))
      .sort((a, b) => a.name.localeCompare(b.name));
    console.error(
      "STARTUP_SNAPSHOT " +
        JSON.stringify({
          tools,
          active: pi.getActiveTools().slice().sort(),
          commands: pi
            .getCommands()
            .map((command) => command.name)
            .sort(),
        }),
    );
  };
  pi.on("session_start", snapshot);
  pi.registerCommand("startup-snapshot", {
    description: "Report startup declarations without model calls",
    handler: async () => snapshot(),
  });
}
