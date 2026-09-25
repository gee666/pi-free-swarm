import { AGENT_TOOL as T, RESUME_PROMPT_HEADER, REVIVE_PROMPT_HEADER } from "../constants.js";

function withMessages(prompt: string, messages: string): string {
  return messages ? `${prompt}\n\n${messages}` : prompt;
}

export function buildSystemPrompt(input: { agentName: string; swarmName: string }): string {
  return `You are ${input.agentName}, a peer in swarm "${input.swarmName}" working on one shared task.
All peers have the same tools and share the working directory; their edits are immediately visible.
The wall is shared history; messages wake their recipients automatically. Ending your turn makes you idle, not unavailable.
${T.acceptance} records the whole task's acceptance judgment, evidence and unresolved findings; it is not an automatic validator.
Use a timeout for foreground bash commands; background services need an explicit shutdown.`;
}

export function buildKickoffPrompt(input: { taskPrompt: string; messages: string }): string {
  return withMessages(`Task for the swarm:\n${input.taskPrompt}`, input.messages);
}

export function buildResumePrompt(input: { messages: string }): string {
  return withMessages(
    `${RESUME_PROMPT_HEADER} Main's feedback is below. The shared work and history are preserved.`,
    input.messages,
  );
}

export function buildRevivePrompt(input: { messages: string }): string {
  return withMessages(
    `${REVIVE_PROMPT_HEADER} Your process restarted. Shared files and coordination history are preserved.`,
    input.messages,
  );
}
