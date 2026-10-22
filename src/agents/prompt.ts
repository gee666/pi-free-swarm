import { AGENT_TOOL as T, RESUME_PROMPT_HEADER, REVIVE_PROMPT_HEADER } from "../constants.js";

function withMessages(prompt: string, messages: string): string {
  return messages ? `${prompt}\n\n${messages}` : prompt;
}

function criteriaText(criteria: readonly string[]): string {
  return `Main's acceptance criteria:\n${criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")}`;
}

export function buildSystemPrompt(input: {
  agentName: string;
  swarmName: string;
  bodyMaxChars: number;
  acceptanceCriteria: readonly string[];
}): string {
  return `You are ${input.agentName}, one of the agents in swarm "${input.swarmName}" working on one shared task.
All agents share the working directory; their edits are immediately visible.
Work together until the shared task is fully done and accepted, or the swarm agrees it is blocked. Take a piece of work, finish it and report it on the wall. Then check the wall and what the others are doing, and pick up the next useful work: unclaimed work, gaps, verification or fixes. Do not sit idle while the goal is unmet. Idle agents receive reminders until a terminal vote is reached; there is no reminder cap.
The wall is shared history; messages wake their recipients automatically. Ending your turn makes you idle, not unavailable.
Posts, comments and messages: at most ${input.bodyMaxChars} characters; put longer material in a file and share its path.
Use ${T.acceptance} with {"action":"inspect"} to read criteria, votes, counts, threshold and totalAgents. Vote on the whole task with {"action":"vote","verdict":"accepted","reason":"your evidence or unresolved gaps"}. Give a nonempty reason. Vote accepted when the shared task meets Main's criteria, incomplete when useful work remains, or blocked when progress needs outside input or action. Update your vote as the work changes. This is a whole-task judgment, not an enforced criterion-by-criterion assessment or an automatic validator.
The run ends when at least 70% of all workers vote the same terminal verdict, accepted or blocked, rounded up to a whole worker. Accepted and blocked votes do not combine; incomplete votes do not end the run. All workers count, including crashed workers; Main, User and Watcher do not vote. A terminal quorum ends the run even if agents are active or messages remain.
${criteriaText(input.acceptanceCriteria)}
Use a timeout for foreground bash commands; background services need an explicit shutdown.`;
}

export function buildKickoffPrompt(input: {
  taskPrompt: string;
  acceptanceCriteria: readonly string[];
  messages: string;
}): string {
  return withMessages(
    `Task for the swarm:\n${input.taskPrompt}\n\n${criteriaText(input.acceptanceCriteria)}`,
    input.messages,
  );
}

export function buildResumePrompt(input: { acceptanceCriteria: readonly string[]; messages: string }): string {
  return withMessages(
    `${RESUME_PROMPT_HEADER} Main's feedback is below. The shared work and history are preserved.\n\n${criteriaText(input.acceptanceCriteria)}`,
    input.messages,
  );
}

export function buildRevivePrompt(input: { acceptanceCriteria: readonly string[]; messages: string }): string {
  return withMessages(
    `${REVIVE_PROMPT_HEADER} Your process restarted. Shared files and coordination history are preserved.\n\n${criteriaText(input.acceptanceCriteria)}`,
    input.messages,
  );
}
