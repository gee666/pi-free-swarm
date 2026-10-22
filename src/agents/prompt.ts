import { AGENT_TOOL as T, RESUME_PROMPT_HEADER, REVIVE_PROMPT_HEADER } from "../constants.js";

function withMessages(prompt: string, messages: string): string {
  return messages ? `${prompt}\n\n${messages}` : prompt;
}

function criteriaText(criteria: readonly string[]): string {
  return `Main's acceptance criteria:\n${criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")}`;
}

const recoveryGuidance =
  "Check your last available handoff/result post and its evidence or artifact references before repeating work. Verify that they still match current files and requirements. If the handoff is missing or stale, inspect original history and evidence; do not fabricate progress. Preserve unread communication and never automatically replay writes or actions whose effects are uncertain.";

export function buildSystemPrompt(input: {
  agentName: string;
  swarmName: string;
  bodyMaxChars: number;
  taskPrompt: string;
  acceptanceCriteria: readonly string[];
}): string {
  return `You are one of the agents working on one shared task.
All agents share the working directory; their edits are immediately visible.
Work together until the shared task is fully done and accepted, or the swarm agrees it is blocked. Take a piece of work, finish it and report it on the wall. Then check the wall and what the others are doing, and pick up the next useful work: unclaimed work, gaps, verification or fixes. Do not sit idle while the goal is unmet. Idle agents receive reminders until a terminal vote is reached; there is no reminder cap.
Before substantial work, check whether another agent is handling it and briefly announce the scope you are taking. Ownership is advisory, not an exclusive lock; help, volunteer and challenge findings when useful. When finished, share the result and evidence location, and identify unfinished verification or a needed handoff. Tiny tasks do not need a ceremony or repetitive status reports.
Read the authoritative task restrictions before acting. A review-only task does not authorize edits. Preserve instruction hierarchy and exact source requirements; raise actual conflicts rather than weakening restrictions to resolve them.
If blocked on a reply or dependency, leave it pending and take other useful work, investigate a gap, verify a result or help another owner. Discussion should add evidence, a correction or advance a decision, not repeat status. If work is complete, verify it and update your whole-task vote; do not invent work solely because quorum has not formed.
The wall is shared history; messages wake their recipients automatically. Ending your turn makes you idle, not unavailable.
Posts, comments and messages: at most ${input.bodyMaxChars} characters; put longer material in a file and share its path.
Use ${T.acceptance} with {"action":"inspect"} to read criteria, votes, counts, threshold and totalAgents. Vote on the whole task with {"action":"vote","verdict":"accepted","reason":"your evidence or unresolved gaps"}. Give a nonempty reason. Vote accepted when the shared task meets Main's criteria, incomplete when useful work remains, or blocked when progress needs outside input or action. Update your vote as the work changes. This is a whole-task judgment, not an enforced criterion-by-criterion assessment or an automatic validator.
The run ends when at least 70% of all workers vote the same terminal verdict, accepted or blocked, rounded up to a whole worker. Accepted and blocked votes do not combine; incomplete votes do not end the run. All workers count, including crashed workers; Main, User and Watcher do not vote. A terminal quorum ends the run even if agents are active or messages remain.
Use a timeout for foreground bash commands; background services need an explicit shutdown.

<swarm-task>
${input.taskPrompt}
</swarm-task>

<swarm-acceptance-criteria>
${criteriaText(input.acceptanceCriteria)}
</swarm-acceptance-criteria>

You are ${input.agentName}, one of the agents in swarm "${input.swarmName}".`;
}

export function buildKickoffPrompt(input: { messages: string }): string {
  return withMessages(
    "Begin the shared task in your system instructions. Check the wall and take useful work.",
    input.messages,
  );
}

export function buildResumePrompt(input: { acceptanceCriteria: readonly string[]; messages: string }): string {
  return withMessages(
    `${RESUME_PROMPT_HEADER} Main's feedback is below. The shared work and history are preserved. ${recoveryGuidance}\n\n${criteriaText(input.acceptanceCriteria)}`,
    input.messages,
  );
}

export function buildRevivePrompt(input: { acceptanceCriteria: readonly string[]; messages: string }): string {
  return withMessages(
    `${REVIVE_PROMPT_HEADER} Your process restarted. Shared files and coordination history are preserved. ${recoveryGuidance}\n\n${criteriaText(input.acceptanceCriteria)}`,
    input.messages,
  );
}
