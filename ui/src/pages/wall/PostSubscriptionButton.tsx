import { Bell, BellOff, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UserPostAttention } from "../../../../src/api-types";
import { fetchPostSubscription, setPostSubscription } from "../../api/subscriptions";
import { useAsync } from "../../api/useAsync";
import { useSwarmStream } from "../../api/SwarmStream";
import { useStreamListener, type EventStream } from "../../api/useEventStream";
import { IconButton } from "../../components/Button";
import styles from "./PostSubscriptionButton.module.css";

interface PostSubscriptionButtonProps {
  swarmId: number | string;
  postId: number;
  subscribed: boolean | undefined;
  onChange?: (state: UserPostAttention) => void;
}

export function PostSubscriptionButton(props: PostSubscriptionButtonProps) {
  const stream = useSwarmStream();
  return (
    <SubscriptionControl key={`${props.swarmId}:${props.postId}:${stream.openCount}`} {...props} stream={stream} />
  );
}

function SubscriptionControl({
  swarmId,
  postId,
  subscribed,
  onChange,
  stream,
}: PostSubscriptionButtonProps & { stream: EventStream }) {
  const [confirmed, setConfirmed] = useState(subscribed);
  const [readRequested, setReadRequested] = useState(false);
  const [writeError, setWriteError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const observed = useRef(0);
  const mutation = useRef<AbortController | null>(null);
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);
  const shouldRead = readRequested || subscribed === undefined;
  const status = useAsync((signal) => fetchPostSubscription(swarmId, postId, signal), [swarmId, postId], shouldRead);
  useStreamListener(stream, (event) => {
    if (event.type !== "user.post.updated" || event.swarmId !== Number(swarmId) || event.payload.postId !== postId)
      return;
    observed.current++;
    status.update(() => event.payload);
    setConfirmed(event.payload.userSubscribed);
    setWriteError(undefined);
  });
  useEffect(() => setConfirmed(subscribed), [subscribed]);
  useEffect(() => {
    if (!status.data) return;
    setConfirmed(status.data.userSubscribed);
    setWriteError(undefined);
    changed.current?.(status.data);
  }, [status.data]);
  useEffect(() => () => mutation.current?.abort(), []);

  async function toggle() {
    if (mutation.current || confirmed === undefined || writeError) return;
    const controller = new AbortController();
    mutation.current = controller;
    const beforeEvents = observed.current;
    setSaving(true);
    try {
      const state = await setPostSubscription(swarmId, postId, !confirmed, controller.signal);
      if (controller.signal.aborted || beforeEvents !== observed.current) return;
      setConfirmed(state.userSubscribed);
      onChange?.(state);
    } catch (error: unknown) {
      if (!controller.signal.aborted && beforeEvents === observed.current) {
        const message = error instanceof Error ? error.message : String(error);
        setWriteError(`${message} Refresh subscription before another change; the previous write may have succeeded.`);
      }
    } finally {
      if (mutation.current === controller) mutation.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  function refresh() {
    setReadRequested(true);
    status.reload();
  }

  const reading = shouldRead && status.loading;
  const unavailable = confirmed === undefined;
  const label = unavailable
    ? "Subscription status unavailable"
    : confirmed
      ? "Unsubscribe from comments"
      : "Subscribe to comments";
  const error = writeError ?? (readRequested ? status.error?.message : undefined);
  return (
    <div className={styles.control}>
      <div className={styles.buttons}>
        <IconButton
          icon={confirmed ? Bell : BellOff}
          label={label}
          title={
            confirmed
              ? "Stop future comment notifications; keep existing history"
              : "Receive future comment notifications"
          }
          aria-pressed={confirmed}
          aria-busy={saving || reading}
          disabled={unavailable || saving || reading || !!writeError}
          className={confirmed ? styles.subscribed : undefined}
          onClick={() => void toggle()}
        />
        {(writeError || status.error) && (
          <IconButton icon={RefreshCw} label="Refresh subscription" onClick={refresh} disabled={saving || reading} />
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
