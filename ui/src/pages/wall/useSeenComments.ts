import { useEffect, useState } from "react";
import type { PostSummary } from "../../../../src/api-types";

/** Comment count per post id the user has already seen. */
type SeenCounts = Record<string, number>;

const storageKey = (swarmId: string) => `pi-swarm:wall-seen:${swarmId}`;

function readSeen(swarmId: string): SeenCounts {
  const raw = window.localStorage.getItem(storageKey(swarmId));
  if (raw === null) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

/**
 * Unread comments per post, remembered in localStorage (the API has no read state for the wall). A post seen
 * for the first time counts as read, so only comments that arrive afterwards raise its badge; the open post
 * is always read.
 */
export function useSeenComments(
  swarmId: string,
  posts: readonly PostSummary[] | undefined,
  openPostId: number | undefined,
): (post: PostSummary) => number {
  const [seen, setSeen] = useState<SeenCounts>(() => readSeen(swarmId));

  useEffect(() => {
    if (!posts) return;
    setSeen((current) => {
      const changes = posts.filter((post) => {
        const known = current[post.id];
        return known === undefined || (post.id === openPostId && known !== post.commentCount);
      });
      if (changes.length === 0) return current;
      return { ...current, ...Object.fromEntries(changes.map((post) => [post.id, post.commentCount])) };
    });
  }, [posts, openPostId]);

  useEffect(() => window.localStorage.setItem(storageKey(swarmId), JSON.stringify(seen)), [swarmId, seen]);

  return (post) => Math.max(0, post.commentCount - (seen[post.id] ?? post.commentCount));
}
