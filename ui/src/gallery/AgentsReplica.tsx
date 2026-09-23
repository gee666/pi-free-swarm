import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { Mail, Reply } from "lucide-react";
import { TEXT_MAX } from "../../../src/limits";
import { Avatar } from "../components/Avatar";
import { Button, IconButton } from "../components/Button";
import { ComposeBox } from "../components/compose/ComposeBox";
import { DeliveryList, DeliverySummary } from "../components/DeliveryStatus";
import { EntityHeader } from "../components/EntityHeader";
import { CountBadge, StatusDot } from "../components/Indicators";
import { ListRow } from "../components/ListRow";
import { MessageRow } from "../components/MessageRow";
import { Panel, PanelBody, PanelHeader } from "../components/Panel";
import { RecipientPill } from "../components/Pill";
import { RichText } from "../components/RichText";
import { RowList } from "../components/RowList";
import { SegmentedControl } from "../components/SegmentedControl";
import { agentDotStatus } from "../lib/swarmStatus";
import { formatTimestamp } from "../lib/time";
import { AppShell, PanelLayout } from "../shell/AppShell";
import { TabRail } from "../shell/TabRail";
import { TopBar } from "../shell/TopBar";
import styles from "./Gallery.module.css";
import { mockAgents, mockExpandedBody, mockInbox, mockSwarm, mockSwarms } from "./mockData";

const BOXES = [
  { value: "inbox", label: "Inbox (3)" },
  { value: "sent", label: "Sent" },
] as const;

function AgentList({ selected, onSelect }: { selected: string; onSelect: (name: string) => void }) {
  return (
    <Panel>
      <PanelHeader title="Agents" />
      <PanelBody>
        <RowList>
          {mockAgents.map((agent) => (
            <ListRow
              key={agent.name}
              avatar={agent.name}
              title={agent.name}
              selected={agent.name === selected}
              onSelect={() => onSelect(agent.name)}
              trailing={
                <>
                  <StatusDot status={agentDotStatus(agent.status)} />
                  <IconButton icon={Mail} label={`Message ${agent.name}`} />
                  <CountBadge count={agent.unread} reserveSpace />
                </>
              }
            />
          ))}
        </RowList>
      </PanelBody>
    </Panel>
  );
}

function Mailbox({ name }: { name: string }) {
  const [box, setBox] = useState<"inbox" | "sent">("inbox");
  const [expanded, setExpanded] = useState<number | null>(3);
  return (
    <Panel>
      <EntityHeader
        avatar={<Avatar name={name} size="lg" accent />}
        title={name}
        subtitle="Mailbox"
        actions={<SegmentedControl label="Mailbox" options={BOXES} value={box} onChange={setBox} />}
      />
      <Panel inset>
        <PanelBody>
          <RowList>
            {mockInbox.map((message) => (
              <MessageRow
                key={message.id}
                unread
                sender={message.sender}
                subject={message.subject}
                meta={<RecipientPill names={[name]} />}
                status={<DeliverySummary recipients={message.recipients} />}
                time={formatTimestamp(message.time)}
                expanded={expanded === message.id}
                onToggle={() => setExpanded(expanded === message.id ? null : message.id)}
              >
                <RichText text={mockExpandedBody} />
                <hr className={styles.divider} />
                <div className={styles.expandedFooter}>
                  <DeliveryList recipients={message.recipients} />
                  <Button icon={Reply}>Reply</Button>
                </div>
              </MessageRow>
            ))}
          </RowList>
        </PanelBody>
      </Panel>
    </Panel>
  );
}

/** Static copy of style-reference/variant-a-minimal-agents.png built from the shared components. */
export function AgentsReplica() {
  const [selected, setSelected] = useState("Maria");
  const [to, setTo] = useState<string[]>(["Maria", "John"]);
  const [text, setText] = useState("");
  return (
    <MemoryRouter initialEntries={["/s/3/agents/Maria"]}>
      <AppShell
        topBar={<TopBar swarms={mockSwarms} current={mockSwarm} onSelectSwarm={() => undefined} />}
        rail={<TabRail basePath="/s/3" />}
      >
        <PanelLayout
          list={<AgentList selected={selected} onSelect={setSelected} />}
          main={<Mailbox name={selected} />}
          compose={
            <ComposeBox
              text={text}
              onTextChange={setText}
              onSend={() => setText("")}
              limit={TEXT_MAX}
              recipients={{ names: to, options: mockAgents.map((agent) => agent.name), onChange: setTo }}
            />
          }
        />
      </AppShell>
    </MemoryRouter>
  );
}
