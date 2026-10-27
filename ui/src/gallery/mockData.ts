import type { ParticipantStatus, RecipientView, SwarmListItem } from "../../../src/api-types";

const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;
const at = (hours: number, minutes: number) => new Date().setHours(hours, minutes, 0, 0);

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

export interface MockMessage {
  id: number;
  sender: string;
  subject: string;
  time: number;
  recipients: RecipientView[];
}

const readBy = (name: string, time: number): RecipientView => ({
  name,
  status: "read",
  deliveredAt: time,
  readAt: time + 60_000,
});

export const mockInbox: MockMessage[] = [
  { id: 1, sender: "John", subject: "Re: OAuth scopes for dashboard", time: at(10, 24), recipients: [] },
  { id: 2, sender: "Liam", subject: "Test results from auth flow", time: at(9, 18), recipients: [] },
  { id: 3, sender: "Oliver", subject: "Updated PR with refresh token logic", time: at(8, 47), recipients: [] },
  { id: 4, sender: "Emma", subject: "Question about OAuth state param", time: at(8, 12), recipients: [] },
  { id: 5, sender: "Noah", subject: "CI is failing on auth e2e tests", time: minutesAgo(60 * 24), recipients: [] },
].map((message) => ({ ...message, recipients: [readBy("Maria", message.time)] }));

export const mockExpandedBody = `Hey Maria,

I've pushed an updated PR with refresh token logic and error handling per the latest notes.
Could you take a look when you have a moment?

Happy to discuss if anything looks off.

– Oliver`;

export const mockRecipients: RecipientView[] = [
  readBy("Maria", at(10, 24)),
  { name: "John", status: "delivered", deliveredAt: at(10, 24), readAt: null },
  { name: "Sofia", status: "pending", deliveredAt: null, readAt: null },
  { name: "Ava", status: "undeliverable", deliveredAt: null, readAt: null },
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
