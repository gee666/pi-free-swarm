import { useLayoutEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { ComposeBox } from "../../components/compose/ComposeBox";
import { Markdown } from "../../components/Markdown";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { ErrorBanner, SkeletonRows } from "../../components/States";
import { cx } from "../../lib/cx";
import { formatTimestamp } from "../../lib/time";
import { useWatcherChat } from "./useWatcherChat";
import styles from "./Watcher.module.css";

// One comfortable line of slack keeps new replies visible without moving readers of older messages.
const NEAR_BOTTOM_PX = 48;

export function WatcherPage() {
  const { id = "" } = useParams();
  return <WatcherChat key={id} swarmId={id} />;
}

function WatcherChat({ swarmId }: { swarmId: string }) {
  const chat = useWatcherChat(swarmId);
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const working = chat.busy || chat.data?.status === "working";
  const error =
    chat.mutationError ??
    chat.error ??
    (chat.data?.status === "error" ? (chat.data.error ?? "Watcher failed.") : undefined);
  const messages = chat.data?.messages ?? [];

  useLayoutEffect(() => {
    nearBottom.current = true;
  }, [chat.data?.sessionId]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && nearBottom.current) element.scrollTop = element.scrollHeight;
  }, [chat.data]);

  return (
    <Panel aria-label="Watcher" className={styles.chat}>
      <PanelHeader
        title={
          <span className={styles.heading}>
            Watcher
            {working && (
              <span className={styles.working} role="status">
                <span className={styles.dot} aria-hidden="true" />
                Working…
              </span>
            )}
          </span>
        }
        action={
          <Button size="sm" onClick={chat.newChat} disabled={chat.resetting} title="New chat">
            New
          </Button>
        }
      />
      <PanelBody
        ref={scroller}
        role="region"
        aria-label="Chat history"
        onScroll={() => {
          const element = scroller.current;
          if (element)
            nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight <= NEAR_BOTTOM_PX;
        }}
      >
        {!chat.data && !chat.error && <SkeletonRows />}
        <ol className={styles.messages} aria-label="Watcher conversation">
          {messages.map((message) => (
            <li key={message.id} className={cx(styles.message, message.role === "user" && styles.own)}>
              <div className={styles.meta}>
                <span className={styles.author}>{message.role === "user" ? "You" : "Watcher"}</span>
                <time dateTime={new Date(message.createdAt).toISOString()}>{formatTimestamp(message.createdAt)}</time>
              </div>
              <Markdown source={message.text} highlightCode />
            </li>
          ))}
        </ol>
      </PanelBody>
      {error && <ErrorBanner action={chat.error && <Button onClick={chat.reload}>Retry</Button>}>{error}</ErrorBanner>}
      <ComposeBox
        text={chat.text}
        onTextChange={chat.setText}
        onSend={chat.send}
        busy={chat.busy}
        sendDisabled={!chat.data || chat.data.status === "working"}
        textareaLabel="Message Watcher"
        placeholder="Message Watcher…"
      />
    </Panel>
  );
}
