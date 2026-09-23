import type {
  AgentParticipantView,
  MailboxResponse,
  MailboxThread,
  MessageView,
  RecipientStatus,
  SwarmDetailResponse,
  SwarmEvent,
  SwarmListItem,
  ThreadView,
} from "../../../../src/api-types";

const AT = new Date(2026, 3, 12, 10, 24).getTime();

export const swarm: SwarmListItem = {
  id: 3,
  name: "auth-refactor",
  taskPrompt: "Implement OAuth login",
  status: "running",
  acceptsMessages: true,
  agentAmount: 3,
  agentsWorking: 2,
  runCount: 1,
  runnerPid: 42,
  createdAt: AT,
  startedAt: AT,
  finishedAt: null,
};

export const agent = (name: string, launchOrder: number, patch: Partial<AgentParticipantView> = {}) => ({
  kind: "agent" as const,
  name,
  status: "working" as const,
  launchOrder,
  reviveCount: 0,
  activity: null,
  unread: 0,
  cost: 0,
  joinedAt: AT,
  lastActivityAt: AT,
  ...patch,
});

export const detail = (patch: Partial<SwarmListItem> = {}): SwarmDetailResponse => ({
  swarm: { ...swarm, ...patch },
  participants: [
    { kind: "user", name: "User", unread: 1, joinedAt: AT, lastActivityAt: AT },
    agent("John", 1, { unread: 2 }),
    agent("Maria", 2, { status: "idle" }),
    agent("Emma", 3, { status: "crashed", unread: 12 }),
  ],
});

let nextId = 100;

export function message(
  threadId: number,
  sender: string,
  to: [string, RecipientStatus][],
  text: string,
  patch: Partial<MessageView> = {},
): MessageView {
  nextId += 1;
  return {
    id: nextId,
    swarmId: 3,
    threadId,
    sender,
    senderKind: sender === "User" ? "user" : sender === "System" ? "system" : "agent",
    text,
    createdAt: AT + nextId * 1000,
    recipients: to.map(([name, status]) => ({ name, status, deliveredAt: AT, readAt: status === "read" ? AT : null })),
    ...patch,
  };
}

export const thread = (id: number, members: string[]): ThreadView => ({
  id,
  swarmId: 3,
  createdBy: members[0],
  createdAt: AT,
  members,
});

export function mailboxThread(record: ThreadView, messages: MessageView[], viewer: string): MailboxThread {
  const unread = messages.filter((item) =>
    item.recipients.some(
      (entry) => entry.name === viewer && (entry.status === "pending" || entry.status === "delivered"),
    ),
  ).length;
  return { thread: record, messages, unread, lastMessageAt: messages[messages.length - 1].createdAt };
}

export const mailbox = (name: string, box: "inbox" | "sent", threads: MailboxThread[]): MailboxResponse => ({
  name,
  box,
  threads,
  total: threads.length,
  unread: threads.reduce((sum, item) => sum + item.unread, 0),
});

/** Common fields of a test event: `{ ...eventBase, type, payload }`. */
export const eventBase: Pick<SwarmEvent, "id" | "swarmId" | "createdAt"> = { id: 1, swarmId: 3, createdAt: AT };
