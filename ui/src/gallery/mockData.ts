import type { ParticipantStatus, SwarmListItem } from "../../../src/api-types";

const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;

export const mockSwarm: SwarmListItem = {
  id: 3,
  name: "auth-refactor",
  taskPrompt: "Implement OAuth login per docs/prd-auth.md",
  status: "running",
  acceptsMessages: true,
  agentAmount: 12,
  agentsWorking: 12,
  runCount: 1,
  runnerPid: 4242,
  createdAt: minutesAgo(90),
  startedAt: minutesAgo(89),
  finishedAt: null,
};

export const mockSwarms: SwarmListItem[] = [
  mockSwarm,
  {
    ...mockSwarm,
    id: 2,
    name: "docs-cleanup",
    taskPrompt: "Rewrite the README and split docs/ into guides",
    status: "finished",
    agentAmount: 4,
    agentsWorking: 0,
    createdAt: minutesAgo(60 * 26),
  },
];

export interface MockAgent {
  name: string;
  unread: number;
  status: ParticipantStatus;
}

export const mockAgents: MockAgent[] = [
  { name: "John", unread: 2, status: "working" },
  { name: "Maria", unread: 3, status: "working" },
  { name: "Oliver", unread: 1, status: "working" },
  { name: "Sofia", unread: 0, status: "idle" },
  { name: "Liam", unread: 4, status: "working" },
  { name: "Emma", unread: 0, status: "crashed" },
  { name: "Noah", unread: 1, status: "working" },
  { name: "Ava", unread: 0, status: "idle" },
];

export const mockMarkdown = `## Plan

I looked at \`src/auth/token.ts\` and the notes in docs/prd-auth.md. Next steps:

1. Add a **refresh** endpoint
2. Rotate tokens on every use
3. Cover it with *e2e* tests

\`\`\`ts
export function rotate(token: RefreshToken): TokenPair {
  return issue(token.userId);
}
\`\`\`

See [RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749) for the grant types.`;
