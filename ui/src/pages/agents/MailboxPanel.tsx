import { useState, type ReactNode } from "react";
import { Inbox, Send } from "lucide-react";
import type { MailboxKind, MailboxThread, ParticipantView, ThreadView } from "../../../../src/api-types";
import { Button } from "../../components/Button";
import { USER_NAME } from "../../api/agents";
import { Panel, PanelBody } from "../../components/Panel";
import { RowList } from "../../components/RowList";
import { SegmentedControl } from "../../components/SegmentedControl";
import { ShowMore } from "../../components/ShowMore";
import { EmptyState, ErrorBanner, SkeletonRows } from "../../components/States";
import { ThreadRow } from "./ThreadRow";
import { useMailbox } from "./useMailbox";
import styles from "./Agents.module.css";

interface MailboxPanelProps {
  swarmId: string;
  participant: ParticipantView;
  /** Banners shown above the header, e.g. "Connection lost". */
  banners?: ReactNode;
  canSend: boolean;
  onReply: (thread: ThreadView) => void;
}

/** Main panel of the Agents tab: one participant's Inbox or Sent, grouped by thread. */
export function MailboxPanel({ swarmId, participant, banners, canSend, onReply }: MailboxPanelProps) {
  const [box, setBox] = useState<MailboxKind>("inbox");
  const [expanded, setExpanded] = useState<MailboxThread>();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const userInbox = participant.name === USER_NAME && box === "inbox";
  const unreadOnly = userInbox && onlyUnread;
  const mailbox = useMailbox(swarmId, participant.name, box, unreadOnly);
  const boxes = [
    { value: "inbox", label: participant.unread > 0 ? `Inbox (${participant.unread})` : "Inbox" },
    { value: "sent", label: "Sent" },
  ] as const;
  const switchBox = (next: MailboxKind) => {
    setBox(next);
    setExpanded(undefined);
  };
  const threads =
    mailbox.data?.box === box && Boolean(mailbox.data.unreadOnly) === unreadOnly ? mailbox.data.threads : undefined;
  // Opening a User thread marks it read. Keep its contents visible until the reader closes it.
  const visibleThreads =
    threads && unreadOnly && expanded && !threads.some((item) => item.thread.id === expanded.thread.id)
      ? [...threads, { ...expanded, unread: 0 }]
      : threads;

  return (
    <Panel aria-label="Mailbox">
      {banners}
      <div className={styles.toolbar}>
        {userInbox && (
          <Button
            size="sm"
            aria-pressed={onlyUnread}
            onClick={() => {
              setOnlyUnread(!onlyUnread);
              setExpanded(undefined);
            }}
          >
            Show only unread
          </Button>
        )}
        <SegmentedControl label="Mailbox" options={boxes} value={box} onChange={switchBox} />
      </div>
      {mailbox.error && <ErrorBanner>{`Could not load messages: ${mailbox.error.message}`}</ErrorBanner>}
      <div className={styles.mailboxBody}>
        {visibleThreads === undefined ? (
          !mailbox.error && <SkeletonRows />
        ) : visibleThreads.length === 0 ? (
          <EmptyState
            icon={box === "inbox" ? Inbox : Send}
            text={unreadOnly ? "No unread messages" : box === "inbox" ? "No messages yet" : "Nothing sent yet"}
          />
        ) : (
          <PanelBody>
            <RowList>
              {visibleThreads.map((item) => (
                <ThreadRow
                  key={item.thread.id}
                  swarmId={swarmId}
                  viewer={participant.name}
                  box={box}
                  item={item}
                  expanded={expanded?.thread.id === item.thread.id}
                  onToggle={() => setExpanded(expanded?.thread.id === item.thread.id ? undefined : item)}
                  canSend={canSend}
                  onReply={onReply}
                />
              ))}
            </RowList>
            <ShowMore more={mailbox} />
          </PanelBody>
        )}
      </div>
    </Panel>
  );
}
