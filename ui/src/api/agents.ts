import type {
  MailboxQuery,
  MailboxResponse,
  MarkReadRequest,
  MarkReadResponse,
  ParticipantView,
  ReplyRequest,
  ReservedName,
  SendMessageRequest,
  SendMessageResponse,
  SwarmDetailResponse,
  SwarmEvent,
  ThreadResponse,
  UnreadCounts,
} from "../../../src/api-types";
import { getJson, postJson } from "./http";

/** The human at the board; the REST API always acts as this participant. */
export const USER_NAME = "User" satisfies ReservedName;

/** The UI calls the human "You" in messages, posts and comments. */
export const displayName = (name: string) => (name === USER_NAME ? "You" : name);

const swarmUrl = (swarmId: number | string) => `/api/swarms/${encodeURIComponent(swarmId)}`;

/** Swarm record plus participants: `User` first, then agents by launch order. */
export function fetchSwarmDetail(swarmId: number | string, signal: AbortSignal): Promise<SwarmDetailResponse> {
  return getJson<SwarmDetailResponse>(swarmUrl(swarmId), signal);
}

export function fetchMailbox(
  swarmId: number | string,
  name: string,
  query: MailboxQuery,
  signal?: AbortSignal,
): Promise<MailboxResponse> {
  const params = new URLSearchParams();
  if (query.box) params.set("box", query.box);
  if (query.count !== undefined) params.set("count", String(query.count));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const url = `${swarmUrl(swarmId)}/participants/${encodeURIComponent(name)}/messages?${params}`;
  return getJson<MailboxResponse>(url, signal);
}

export function fetchThread(swarmId: number | string, threadId: number, signal: AbortSignal): Promise<ThreadResponse> {
  return getJson<ThreadResponse>(`${swarmUrl(swarmId)}/threads/${threadId}`, signal);
}

/** Starts a new thread as `User`; rejects with `ApiError` code `swarm_not_running` (409) when not live. */
export function sendMessage(swarmId: number | string, request: SendMessageRequest): Promise<SendMessageResponse> {
  return postJson<SendMessageResponse>(`${swarmUrl(swarmId)}/messages`, request);
}

/** Same 409 rule as `sendMessage`. */
export function replyToThread(
  swarmId: number | string,
  threadId: number,
  request: ReplyRequest,
): Promise<SendMessageResponse> {
  return postJson<SendMessageResponse>(`${swarmUrl(swarmId)}/threads/${threadId}/reply`, request);
}

export function markUserRead(swarmId: number | string, messageIds: number[]): Promise<MarkReadResponse> {
  const request: MarkReadRequest = { messageIds };
  return postJson<MarkReadResponse>(`${swarmUrl(swarmId)}/participants/User/read`, request);
}

/** Maps participants, keeping the original array when `patch` changed none of them. */
function patchEach(
  participants: ParticipantView[],
  patch: (participant: ParticipantView) => ParticipantView,
): ParticipantView[] {
  const next = participants.map(patch);
  return next.every((participant, index) => participant === participants[index]) ? participants : next;
}

function withUnread(participants: ParticipantView[], unread: UnreadCounts): ParticipantView[] {
  return patchEach(participants, (participant) => {
    const count = unread[participant.name];
    return count === undefined || count === participant.unread ? participant : { ...participant, unread: count };
  });
}

/** Applies the participant-related part of an SSE event; returns the same array when nothing changed. */
export function applyParticipantEvent(participants: ParticipantView[], event: SwarmEvent): ParticipantView[] {
  switch (event.type) {
    case "participant.updated": {
      const next = event.payload.participant;
      const known = participants.some((participant) => participant.name === next.name);
      return known
        ? participants.map((participant) => (participant.name === next.name ? next : participant))
        : [...participants, next];
    }
    case "usage.updated": {
      const { agent, usage } = event.payload;
      return patchEach(participants, (participant) =>
        participant.kind === "agent" && participant.name === agent && participant.cost !== usage.cost
          ? { ...participant, cost: usage.cost }
          : participant,
      );
    }
    case "message.created":
    case "message.status":
      return withUnread(participants, event.payload.unread);
    default:
      return participants;
  }
}
