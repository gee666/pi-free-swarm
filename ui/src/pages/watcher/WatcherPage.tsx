import { Link, useParams } from "react-router-dom";
import { USER_NAME, WATCHER_NAME } from "../../../../src/constants";
import { displayName } from "../../api/agents";
import { AuthoredEntry } from "../../components/AuthoredEntry";
import { Button } from "../../components/Button";
import { ComposeBox } from "../../components/compose/ComposeBox";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { RichText } from "../../components/RichText";
import { ErrorBanner, SkeletonRows } from "../../components/States";
import { formatTimestamp } from "../../lib/time";
import { useSwarmDetail } from "../agents/useSwarmDetail";
import { useUserCommentRead } from "../wall/useUserCommentRead";
import { activityLabel } from "../work/activity";
import { useWatcherChat } from "./useWatcherChat";
import styles from "./Watcher.module.css";

export function WatcherPage() {
  const { id = "" } = useParams();
  const detail = useSwarmDetail(id);
  const chat = useWatcherChat(id);
  const watcher = detail.data?.participants.find((participant) => participant.name === WATCHER_NAME);
  const conversation = chat.data?.conversation;
  const names = detail.data?.participants.map((participant) => participant.name) ?? [];
  const readError = useUserCommentRead(id, conversation?.post.id, conversation ?? undefined, true);
  const entries = conversation ? [conversation.post, ...conversation.comments.slice().reverse()] : [];
  return (
    <Panel aria-label="Watcher">
      <PanelHeader title="Watcher" />
      <PanelBody>
        {detail.error && <ErrorBanner>{detail.error.message}</ErrorBanner>}
        {watcher?.kind === "agent" && (
          <p role="status">
            Watcher: {watcher.status} · {activityLabel(watcher)}
          </p>
        )}
        <p>This conversation is saved on the Wall. Messages automatically notify Watcher.</p>
        {detail.data && !detail.data.swarm.acceptsMessages && (
          <p>Messages are saved, not delivered yet. Watcher can answer after the swarm resumes.</p>
        )}
        {chat.error && (
          <ErrorBanner action={<Button onClick={chat.reload}>Retry</Button>}>{chat.error.message}</ErrorBanner>
        )}
        {!chat.data && !chat.error && <SkeletonRows />}
        {chat.data && !conversation && <p>Ask Watcher about the swarm.</p>}
        <ol className={styles.messages} aria-label="Watcher conversation">
          {entries.map((entry, index) => (
            <AuthoredEntry
              key={index === 0 ? `post:${entry.id}` : `comment:${entry.id}`}
              author={displayName(entry.author)}
              time={formatTimestamp(entry.createdAt)}
              own={entry.author === USER_NAME}
            >
              <RichText text={entry.text} mentionNames={names} />
            </AuthoredEntry>
          ))}
        </ol>
        {conversation && <Link to={`/s/${id}/wall/${conversation.post.id}`}>Open conversation on the Wall</Link>}
      </PanelBody>
      {readError && <ErrorBanner>{readError}</ErrorBanner>}
      {chat.sendError && <ErrorBanner>{chat.sendError.message}</ErrorBanner>}
      <ComposeBox
        text={chat.text}
        onTextChange={chat.setText}
        onSend={() => void chat.send()}
        busy={chat.busy}
        textareaLabel="Message Watcher"
        placeholder="Ask Watcher about the swarm…"
        uploadSwarmId={id}
        uploadScope="watcher"
        mentionNames={names}
      />
    </Panel>
  );
}
