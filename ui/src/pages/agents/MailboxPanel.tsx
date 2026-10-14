import { useState, type ReactNode } from "react";
import { Inbox, Send } from "lucide-react";
import type { MailboxKind, ParticipantView, ThreadView } from "../../../../src/api-types";
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
  const [expanded, setExpanded] = useState<number>();
  const mailbox = useMailbox(swarmId, participant.name, box);
  const boxes = [
    { value: "inbox", label: participant.unread > 0 ? `Inbox (${participant.unread})` : "Inbox" },
    { value: "sent", label: "Sent" },
  ] as const;
  const switchBox = (next: MailboxKind) => {
    setBox(next);
    setExpanded(undefined);
  };
  const threads = mailbox.data?.box === box ? mailbox.data.threads : undefined;

  return (
    <Panel aria-label="Mailbox">
      {banners}
      <div className={styles.toolbar}>
        <SegmentedControl label="Mailbox" options={boxes} value={box} onChange={switchBox} />
      </div>
      {mailbox.error && <ErrorBanner>{`Could not load messages: ${mailbox.error.message}`}</ErrorBanner>}
      <div className={styles.mailboxBody}>
        {threads === undefined ? (
          !mailbox.error && <SkeletonRows />
        ) : threads.length === 0 ? (
          <EmptyState
            icon={box === "inbox" ? Inbox : Send}
            text={box === "inbox" ? "No messages yet" : "Nothing sent yet"}
          />
        ) : (
          <PanelBody>
            <RowList>
              {threads.map((item) => (
                <ThreadRow
                  key={item.thread.id}
                  swarmId={swarmId}
                  viewer={participant.name}
                  box={box}
                  item={item}
                  expanded={expanded === item.thread.id}
                  onToggle={() => setExpanded(expanded === item.thread.id ? undefined : item.thread.id)}
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
