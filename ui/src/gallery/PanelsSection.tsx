import { useState } from "react";
import { Inbox, Mail, MessageCircle } from "lucide-react";
import { TEXT_MAX } from "../../../src/limits";
import { Avatar } from "../components/Avatar";
import { Button, IconButton } from "../components/Button";
import { ComposeBox, type ComposeBoxProps } from "../components/compose/ComposeBox";
import { DeliveryList, DeliverySummary } from "../components/DeliveryStatus";
import { EntityHeader } from "../components/EntityHeader";
import { CountBadge, StatusDot } from "../components/Indicators";
import { ListRow } from "../components/ListRow";
import { Markdown } from "../components/Markdown";
import { MessageRow } from "../components/MessageRow";
import { Panel, PanelHeader } from "../components/Panel";
import { Pill, RecipientPill } from "../components/Pill";
import { RichText } from "../components/RichText";
import { EmptyState, ErrorBanner, SkeletonRows } from "../components/States";
import styles from "./Gallery.module.css";
import { mockAgents, mockMarkdown, mockRecipients } from "./mockData";
import { Section } from "./Section";

type ComposeDemoProps = Omit<ComposeBoxProps, "text" | "onTextChange" | "onSend" | "limit" | "recipients"> & {
  initialText?: string;
  withRecipients?: boolean;
};

function ComposeDemo({ initialText = "", withRecipients = true, ...props }: ComposeDemoProps) {
  const [text, setText] = useState(initialText);
  const [to, setTo] = useState<string[]>(["Maria", "John"]);
  const options = ["User", ...mockAgents.map((agent) => agent.name)];
  return (
    <ComposeBox
      {...props}
      text={text}
      onTextChange={setText}
      onSend={() => setText("")}
      limit={TEXT_MAX}
      recipients={withRecipients ? { names: to, options, onChange: setTo } : undefined}
    />
  );
}

function ListPanel() {
  const [selected, setSelected] = useState("Maria");
  const agent = (name: string, unread: number) => (
    <ListRow
      avatar={name}
      title={name}
      selected={selected === name}
      onSelect={() => setSelected(name)}
      trailing={
        <>
          <StatusDot status="live" />
          <IconButton icon={Mail} label={`Message ${name}`} />
          <CountBadge count={unread} reserveSpace />
        </>
      }
    />
  );
  return (
    <Panel className={styles.listPanel}>
      <PanelHeader title="Agents" action={<Button>Action</Button>} />
      <ListRow
        avatar="You"
        title="User"
        titleAddon={<Pill>you</Pill>}
        selected={selected === "User"}
        onSelect={() => setSelected("User")}
        trailing={<CountBadge count={1} />}
      />
      {agent("Maria", 3)}
      {agent("Sofia", 0)}
      <ListRow
        avatar="Oliver"
        avatarSize="sm"
        title="Refresh token rotation plan"
        subtitle="Oliver · 12:04"
        selected={selected === "post"}
        onSelect={() => setSelected("post")}
        trailing={<Pill icon={MessageCircle}>4</Pill>}
      />
      <SkeletonRows count={2} avatar />
    </Panel>
  );
}

export function PanelsSection() {
  const [expanded, setExpanded] = useState(true);
  return (
    <>
      <Section title="List panel, entity header">
        <ListPanel />
        <Panel className={styles.mainPanel}>
          <EntityHeader avatar={<Avatar name="Oliver" size="lg" accent />} title="Oliver" subtitle="Post by Oliver" />
          <ErrorBanner>Connection lost. Reconnecting…</ErrorBanner>
          <Panel inset>
            <MessageRow
              sender="System"
              subject="The swarm is finished. This message will not be delivered."
              time="Yesterday"
              expanded={false}
              onToggle={() => undefined}
            />
            <MessageRow
              unread
              sender="Oliver"
              subject="Updated PR with refresh token logic"
              meta={<RecipientPill names={mockRecipients.map((recipient) => recipient.name)} />}
              status={<DeliverySummary recipients={mockRecipients} />}
              time="08:47 AM"
              expanded={expanded}
              onToggle={() => setExpanded(!expanded)}
            >
              <RichText text={"See src/auth/token.ts and docs/prd-auth.md.\nThanks!"} />
              <DeliveryList recipients={mockRecipients} />
            </MessageRow>
          </Panel>
        </Panel>
      </Section>
      <Section title="Empty and loading">
        <Panel className={styles.smallPanel}>
          <EmptyState icon={Inbox} text="No messages yet" action={<Button>New message</Button>} />
        </Panel>
        <Panel className={styles.smallPanel}>
          <SkeletonRows count={3} />
        </Panel>
      </Section>
      <Section title="Compose" column>
        <ComposeDemo />
        <ComposeDemo thread={{ id: 12, onCancel: () => undefined }} initialText="Sounds good." />
        <ComposeDemo disabled />
        <ComposeDemo withRecipients={false} placeholder="Write a comment…" sendLabel="Comment" />
        <ComposeDemo initialText={"x".repeat(TEXT_MAX + 5)} />
      </Section>
      <Section title="Markdown (Work tab)" column>
        <Panel className={styles.markdownPanel}>
          <Markdown source={mockMarkdown} />
        </Panel>
      </Section>
    </>
  );
}
