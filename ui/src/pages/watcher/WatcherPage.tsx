import { useLayoutEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { WATCHER_NAME } from "../../../../src/constants";
import { displayName, USER_NAME } from "../../api/agents";
import { AuthoredEntry } from "../../components/AuthoredEntry";
import { ComposeBox } from "../../components/compose/ComposeBox";
import { Markdown } from "../../components/Markdown";
import { cx } from "../../lib/cx";
import { ErrorBanner, SkeletonRows } from "../../components/States";
import { formatTimestamp } from "../../lib/time";
import { useSwarmDetail } from "../agents/useSwarmDetail";
import { useWatcher } from "./useWatcher";
import styles from "./Watcher.module.css";

export function WatcherPage() {
  const { id = "" } = useParams();
  return <WatcherChat key={id} swarmId={id} />;
}

function WatcherChat({ swarmId }: { swarmId: string }) {
  const detail = useSwarmDetail(swarmId);
  const { chat, text, setText, sending, error, send } = useWatcher(swarmId);
  const watcher = detail.data?.participants.find((participant) => participant.name === WATCHER_NAME);
  const available =
    detail.data?.swarm.acceptsMessages === true &&
    watcher?.kind === "agent" &&
    watcher.status !== "crashed" &&
    watcher.status !== "stopped";
  const busy = available && watcher?.kind === "agent" && watcher.status === "working";
  const failure = error ?? chat.error?.message ?? detail.error?.message;
  const messages = [...(chat.data?.messages ?? [])].sort((a, b) => a.id - b.id);
  const messageList = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const latestMessageId = messages.at(-1)?.id;
  useLayoutEffect(() => {
    const list = messageList.current;
    if (list && following.current) list.scrollTop = list.scrollHeight;
  }, [latestMessageId, busy]);
  return (
    <section className={styles.page} aria-label="Watcher chat">
      {failure && <ErrorBanner>{failure}</ErrorBanner>}
      {chat.loading && !chat.data && <SkeletonRows />}
      <ol
        ref={messageList}
        className={styles.messages}
        aria-label="Messages, oldest first"
        aria-busy={busy}
        onScroll={(event) => {
          const list = event.currentTarget;
          following.current = Math.ceil(list.scrollTop + list.clientHeight) >= list.scrollHeight;
        }}
      >
        {messages.map((message) => (
          <AuthoredEntry
            key={message.id}
            author={displayName(message.sender)}
            className={cx(styles.message, message.sender === USER_NAME && styles.userMessage)}
            system={message.senderKind === "system"}
            time={formatTimestamp(message.createdAt)}
          >
            <Markdown source={message.text} />
          </AuthoredEntry>
        ))}
        {busy && (
          <li className={styles.thinking} role="status">
            thinking<span className={styles.dots}>…</span>
          </li>
        )}
      </ol>
      <ComposeBox
        text={text}
        onTextChange={setText}
        onSend={() => void send()}
        limit={detail.data?.bodyMaxChars ?? 0}
        busy={sending}
        disabled={!detail.data}
        disabledNotice="Watcher starts with the next run"
        placeholder={available ? "Ask about the swarm…" : "Watcher starts with the next run"}
      />
    </section>
  );
}
