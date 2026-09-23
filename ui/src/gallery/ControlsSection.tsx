import { useRef, useState } from "react";
import { Mail, MessageCircle, Plus, Send, X } from "lucide-react";
import { TITLE_MAX } from "../../../src/limits";
import { Avatar } from "../components/Avatar";
import { Button, IconButton } from "../components/Button";
import { DeliveryIcon, DeliverySummary } from "../components/DeliveryStatus";
import { TextField } from "../components/Field";
import { CountBadge, StatusDot, UnreadDot } from "../components/Indicators";
import { Menu, useMenuNavigation } from "../components/Menu";
import { Popover } from "../components/Popover";
import { Pill, RecipientPill } from "../components/Pill";
import { RecipientChip } from "../components/RecipientChip";
import { SegmentedControl } from "../components/SegmentedControl";
import { Tooltip } from "../components/Tooltip";
import styles from "./Gallery.module.css";
import { mockRecipients } from "./mockData";
import { Section } from "./Section";

function PopoverDemo() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState("newest");
  const items = ["newest", "oldest", "most comments"].map((key) => ({ key, label: key, selected: key === sort }));
  const pick = (key: string) => {
    setSort(key);
    setOpen(false);
  };
  const navigation = useMenuNavigation(items, pick);
  return (
    <>
      <Button ref={anchor} onClick={() => setOpen(!open)} onKeyDown={navigation.onKeyDown}>
        Sort: {sort}
      </Button>
      <Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)}>
        <Menu
          id="gallery-sort"
          label="Sort"
          items={items}
          activeIndex={navigation.activeIndex}
          onActiveIndexChange={navigation.setActiveIndex}
          onSelect={pick}
        />
      </Popover>
    </>
  );
}

export function ControlsSection() {
  const [segment, setSegment] = useState<"inbox" | "sent">("inbox");
  const [sort, setSort] = useState<"new" | "active" | "top">("new");
  const [title, setTitle] = useState("A title that is a bit too long for the sixty character limit");
  return (
    <>
      <Section title="Buttons">
        <Button variant="primary" icon={Send}>
          Send
        </Button>
        <Button variant="primary" disabled>
          Post
        </Button>
        <Button icon={Plus}>New post</Button>
        <Button size="sm" icon={Plus}>
          add agent
        </Button>
        <Button disabled>Disabled</Button>
        <IconButton icon={Mail} label="Message" />
        <IconButton icon={X} label="Close" disabled />
      </Section>
      <Section title="Avatars">
        <Avatar name="Maria" size="xs" />
        <Avatar name="Maria" size="sm" />
        <Avatar name="John" />
        <Avatar name="Maria" size="lg" accent />
        <Avatar name="You" />
        <Avatar name="System" system />
        <Avatar name="System" size="sm" system />
      </Section>
      <Section title="Indicators">
        <CountBadge count={0} />
        <CountBadge count={3} />
        <CountBadge count={12} />
        <UnreadDot unread />
        <UnreadDot unread={false} />
        <StatusDot status="live" />
        <StatusDot status="idle" />
        <StatusDot status="crashed" />
        <StatusDot status="live" size="md" />
        <StatusDot status="idle" size="md" />
      </Section>
      <Section title="Segmented control">
        <SegmentedControl
          label="Mailbox"
          value={segment}
          onChange={setSegment}
          options={[
            { value: "inbox", label: "Inbox (3)" },
            { value: "sent", label: "Sent" },
          ]}
        />
        <SegmentedControl
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: "new", label: "Newest" },
            { value: "active", label: "Active" },
            { value: "top", label: "Top" },
          ]}
        />
      </Section>
      <Section title="Pills and chips">
        <RecipientPill names={["Maria"]} />
        <RecipientPill names={["Maria", "John"]} />
        <RecipientPill names={["Maria", "John", "Liam", "Ava"]} />
        <Pill>you</Pill>
        <Pill icon={MessageCircle}>4</Pill>
        <RecipientChip name="Maria" onRemove={() => undefined} />
        <RecipientChip name="John" />
      </Section>
      <Section title="Delivery status">
        {mockRecipients.map((recipient) => (
          <span key={recipient.name} className={styles.inline}>
            <DeliveryIcon status={recipient.status} /> {recipient.status}
          </span>
        ))}
        <span className={styles.inline}>
          aggregate <DeliverySummary recipients={mockRecipients} />
        </span>
        <span className={styles.inline}>
          all read <DeliverySummary recipients={mockRecipients.slice(0, 1)} />
        </span>
      </Section>
      <Section title="Tooltip, popover, input">
        <Tooltip content="Implement OAuth login per docs/prd-auth.md">
          <Button>Hover me</Button>
        </Tooltip>
        <PopoverDemo />
        <div className={styles.field}>
          <TextField label="Title" value={title} onChange={setTitle} limit={TITLE_MAX} placeholder="Title" />
        </div>
      </Section>
    </>
  );
}
