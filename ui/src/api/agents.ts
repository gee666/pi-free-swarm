import type {
  ParticipantView,
  ReservedName,
  SwarmDetailResponse,
  SwarmEvent,
  UnreadCounts,
} from "../../../src/api-types";
import { getJson } from "./http";

/** The human at the board; the REST API always acts as this participant. */
export const USER_NAME = "User" satisfies ReservedName;

/** The UI calls the human "You" in messages, posts and comments. */
export const displayName = (name: string) => (name === USER_NAME ? "You" : name);

const swarmUrl = (swarmId: number | string) => `/api/swarms/${encodeURIComponent(swarmId)}`;

/** Swarm record plus participants in API order. */
export function fetchSwarmDetail(swarmId: number | string, signal: AbortSignal): Promise<SwarmDetailResponse> {
  return getJson<SwarmDetailResponse>(swarmUrl(swarmId), signal);
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

const activityAt = (participant: ParticipantView) => participant.lastActivityAt ?? participant.joinedAt ?? 0;

export function orderParticipants(participants: readonly ParticipantView[]): ParticipantView[] {
  return [...participants].sort(
    (left, right) => activityAt(right) - activityAt(left) || (right.joinedAt ?? 0) - (left.joinedAt ?? 0),
  );
}

/** Keeps activity lists newest-first without replacing unchanged arrays. */
export function applyParticipantEvent(participants: ParticipantView[], event: SwarmEvent): ParticipantView[] {
  const next = patchParticipantEvent(participants, event);
  return next === participants ? participants : orderParticipants(next);
}

function patchParticipantEvent(participants: ParticipantView[], event: SwarmEvent): ParticipantView[] {
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
    case "message.created": {
      const { message, unread } = event.payload;
      const involved = new Set([message.sender, ...message.recipients.map(({ name }) => name)]);
      const active = patchEach(participants, (participant) =>
        involved.has(participant.name) && message.createdAt > activityAt(participant)
          ? { ...participant, lastActivityAt: message.createdAt }
          : participant,
      );
      return withUnread(active, unread);
    }
    case "message.status":
      return withUnread(participants, event.payload.unread);
    default:
      return participants;
  }
}
