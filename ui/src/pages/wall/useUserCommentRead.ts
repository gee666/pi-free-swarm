import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PostDetailResponse } from "../../../../src/api-types";
import { PAGE_MAX_COUNT, USER_NAME } from "../../../../src/constants";
import { markUserCommentsRead } from "../../api/wall";

/** Read state follows rendered comment IDs, never merely selecting the Wall tab or a pending route. */
export function useUserCommentRead(
  swarmId: string,
  postId: number | undefined,
  detail: PostDetailResponse | undefined,
  enabled: boolean,
): string | undefined {
  const latest = useRef(detail);
  const subscribed = detail?.post.userSubscribed;
  const unread = detail?.post.userUnreadComments;
  const [error, setError] = useState<string>();
  const active = useRef<{ controller: AbortController; through: number; busy: boolean; postRead: boolean } | undefined>(
    undefined,
  );
  useLayoutEffect(() => {
    latest.current = detail;
  }, [detail]);
  useEffect(() => {
    const scope = { controller: new AbortController(), through: 0, busy: false, postRead: false };
    active.current = scope;
    setError(undefined);
    return () => {
      scope.controller.abort();
      if (active.current === scope) active.current = undefined;
    };
  }, [swarmId, postId, enabled, subscribed]);
  useEffect(() => {
    const scope = active.current;
    if (
      !scope ||
      !enabled ||
      (subscribed === false && unread === undefined) ||
      unread === 0 ||
      postId === undefined ||
      scope.busy ||
      detail?.post.id !== postId
    )
      return;
    let inspected = detail.comments;
    let inspectedUnread = unread;
    const drain = async () => {
      while (!scope.controller.signal.aborted) {
        const current = latest.current;
        if (!current || current.post.id !== postId || current.post.swarmId !== Number(swarmId)) return;
        inspected = current.comments;
        inspectedUnread = current.post.userUnreadComments;
        if (inspectedUnread === 0) return;
        const batch: number[] = [];
        for (let index = current.comments.length - 1; index >= 0; index--) {
          const comment = current.comments[index];
          if (comment.id > scope.through && comment.author !== USER_NAME) batch.push(comment.id);
          if (batch.length === PAGE_MAX_COUNT) break;
        }
        if (batch.length === 0 && scope.postRead) {
          scope.through = Math.max(scope.through, current.comments[0]?.id ?? 0);
          return;
        }
        const response = await markUserCommentsRead(swarmId, postId, batch, scope.controller.signal);
        if (scope.controller.signal.aborted || (response.updated === 0 && response.userSubscribed === false)) return;
        scope.postRead = true;
        scope.through = batch.at(-1) ?? scope.through;
        if (batch.length === 0) return;
      }
    };
    const start = (): void => {
      const current = latest.current;
      if (
        scope.controller.signal.aborted ||
        active.current !== scope ||
        scope.busy ||
        !current ||
        current.post.id !== postId ||
        current.post.swarmId !== Number(swarmId) ||
        current.post.userUnreadComments === 0
      )
        return;
      scope.busy = true;
      setError(undefined);
      void drain()
        .catch((failure: unknown) => {
          if (!scope.controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
        })
        .finally(() => {
          scope.busy = false;
          if (latest.current?.comments !== inspected || latest.current?.post.userUnreadComments !== inspectedUnread)
            start();
        });
    };
    start();
  }, [swarmId, postId, detail?.post.id, detail?.post.swarmId, detail?.comments, enabled, subscribed, unread]);
  return error;
}
