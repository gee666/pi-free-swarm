import { useParams } from "react-router-dom";
import { WATCHER_NAME } from "../../../../src/constants";
import { displayName, USER_NAME } from "../../api/agents";
import { AuthoredEntry } from "../../components/AuthoredEntry";
import { ComposeBox } from "../../components/compose/ComposeBox";
import { DeliveryList } from "../../components/DeliveryStatus";
import { RichText } from "../../components/RichText";
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
  const messages = [...(chat.data?.messages ?? [])].sort((a, b) => b.id - a.id);
  return (
    <section className={styles.page} aria-label="Watcher chat">
      <h1>Watcher</h1>
      <p>Watcher is available while the swarm runs. Questions sent while unavailable are queued for the next run.</p>
      <ComposeBox
        text={text}
        onTextChange={setText}
        onSend={() => void send()}
        limit={detail.data?.bodyMaxChars ?? 0}
        busy={sending}
        disabled={!detail.data}
        placeholder="Ask Watcher about the swarm…"
        sendLabel={available ? "Send" : "Queue question"}
      />
      <p role="status">
        {busy
          ? "Watcher is answering…"
          : available
            ? "Watcher is idle."
            : "Watcher is unavailable. Questions will be queued."}
      </p>
      {failure && <ErrorBanner>{failure}</ErrorBanner>}
      {chat.loading && !chat.data && <SkeletonRows />}
      <ol className={styles.messages} aria-label="Messages, newest first" aria-busy={busy}>
        {messages.map((message) => (
          <AuthoredEntry
            key={message.id}
            author={displayName(message.sender)}
            own={message.sender === USER_NAME}
            system={message.senderKind === "system"}
            time={formatTimestamp(message.createdAt)}
          >
            <RichText text={message.text} />
            {message.sender === USER_NAME && <DeliveryList recipients={message.recipients} />}
          </AuthoredEntry>
        ))}
      </ol>
    </section>
  );
}
