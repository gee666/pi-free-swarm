import type { MailboxKind, MailboxThread, ThreadView } from "../../../../src/api-types";
import { displayName } from "../../api/agents";
import { DeliverySummary } from "../../components/DeliveryStatus";
import { MessageRow } from "../../components/MessageRow";
import { RecipientPill } from "../../components/Pill";
import { formatTimestamp } from "../../lib/time";
import { subjectOf, visibleRecipients } from "./messageDisplay";
import { ThreadDetail } from "./ThreadDetail";

interface ThreadRowProps {
  swarmId: string;
  /** Canonical name of the participant whose mailbox this is. */
  viewer: string;
  box: MailboxKind;
  item: MailboxThread;
  expanded: boolean;
  onToggle: () => void;
  /** Compose accepts messages; otherwise Reply is disabled. */
  canSend: boolean;
  onReply: (thread: ThreadView) => void;
}

/** A collapsed mailbox row shows the thread's latest message; expanding it shows the whole thread. */
export function ThreadRow({ swarmId, viewer, box, item, expanded, onToggle, canSend, onReply }: ThreadRowProps) {
  const last = item.messages.at(-1);
  if (!last) return null;
  const recipients = visibleRecipients(last, viewer, box);
  return (
    <MessageRow
      unread={item.unread > 0}
      sender={displayName(last.sender)}
      subject={subjectOf(last.text)}
      meta={<RecipientPill names={last.recipients.map((recipient) => displayName(recipient.name))} />}
      status={recipients.length > 0 ? <DeliverySummary recipients={recipients} /> : undefined}
      time={formatTimestamp(last.createdAt)}
      expanded={expanded}
      onToggle={onToggle}
    >
      <ThreadDetail swarmId={swarmId} viewer={viewer} box={box} item={item} canSend={canSend} onReply={onReply} />
    </MessageRow>
  );
}
