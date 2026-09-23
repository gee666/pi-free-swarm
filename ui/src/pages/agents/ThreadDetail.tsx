import { Reply } from "lucide-react";
import type { MailboxKind, MailboxThread, MessageView, ThreadView } from "../../../../src/api-types";
import { displayName } from "../../api/agents";
import { AuthoredEntry } from "../../components/AuthoredEntry";
import { Button } from "../../components/Button";
import { DeliveryList } from "../../components/DeliveryStatus";
import { RichText } from "../../components/RichText";
import { ErrorBanner } from "../../components/States";
import { formatTimestamp } from "../../lib/time";
import styles from "./Agents.module.css";
import { canUserReply, visibleRecipients } from "./messageDisplay";
import { useThread } from "./useThread";

interface ThreadDetailProps {
  swarmId: string;
  viewer: string;
  box: MailboxKind;
  /** The mailbox's part of the thread, shown until the whole thread has loaded. */
  item: MailboxThread;
  canSend: boolean;
  onReply: (thread: ThreadView) => void;
}

/** Expanded thread: every message oldest first, then Reply. */
export function ThreadDetail({ swarmId, viewer, box, item, canSend, onReply }: ThreadDetailProps) {
  const thread = useThread(swarmId, item.thread.id);
  const record = thread.data?.thread ?? item.thread;
  const messages = thread.data?.messages ?? item.messages;
  const failure = thread.error ?? thread.markReadError;
  return (
    <>
      {failure && <ErrorBanner>{failure.message}</ErrorBanner>}
      <ol className={styles.thread} aria-label={`Thread #${record.id}`}>
        {messages.map((message) => (
          <ThreadMessage key={message.id} message={message} viewer={viewer} box={box} />
        ))}
      </ol>
      {canUserReply(record) && (
        <div className={styles.threadFooter}>
          <Button icon={Reply} disabled={!canSend} onClick={() => onReply(record)}>
            Reply
          </Button>
        </div>
      )}
    </>
  );
}

function ThreadMessage({ message, viewer, box }: { message: MessageView; viewer: string; box: MailboxKind }) {
  const recipients = visibleRecipients(message, viewer, box);
  return (
    <AuthoredEntry
      author={displayName(message.sender)}
      system={message.senderKind === "system"}
      time={formatTimestamp(message.createdAt)}
    >
      <RichText text={message.text} />
      {recipients.length > 0 && <DeliveryList recipients={recipients} />}
    </AuthoredEntry>
  );
}
