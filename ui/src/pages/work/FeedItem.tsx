import { useState } from "react";
import { Brain } from "lucide-react";
import type {
  SessionItem,
  SessionSwarmMessageItem,
  SessionSystemItem,
  SessionThinkingItem,
} from "../../../../src/api-types";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { RichText } from "../../components/RichText";
import { cx } from "../../lib/cx";
import { formatTimestamp } from "../../lib/time";
import { FeedBlock } from "./FeedBlock";
import styles from "./FeedBlock.module.css";
import { ToolCallBlock } from "./ToolCallBlock";
import { firstLine } from "./toolText";

function SwarmMessageBlock({ item }: { item: SessionSwarmMessageItem }) {
  const header = (
    <>
      <span className={styles.meta}>{`thread #${item.threadId} · from`}</span>
      <span className={styles.title}>{item.from}</span>
      <span className={styles.summary}>{`· to: ${item.to.join(", ")}`}</span>
    </>
  );
  return (
    <FeedBlock header={header} timestamp={item.timestamp} marked>
      <RichText text={item.text} />
    </FeedBlock>
  );
}

function ThinkingBlock({ item }: { item: SessionThinkingItem }) {
  const [expanded, setExpanded] = useState(false);
  const header = (
    <>
      <Icon icon={Brain} className={styles.icon} />
      <span className={styles.meta}>Thinking</span>
      <span className={styles.summary}>{expanded ? "" : firstLine(item.text)}</span>
    </>
  );
  return (
    <FeedBlock
      header={header}
      timestamp={item.timestamp}
      toggle={{ expanded, onToggle: () => setExpanded((value) => !value) }}
    >
      {expanded && <p className={styles.thinking}>{item.text}</p>}
    </FeedBlock>
  );
}

function SystemLine({ item }: { item: SessionSystemItem }) {
  return (
    <div className={cx(styles.system, item.event === "error" && styles.error)} role="note">
      <span className={styles.systemText}>{`${item.text} · ${formatTimestamp(item.timestamp)}`}</span>
    </div>
  );
}

/** Renders one session item; `agent` titles the agent's own text blocks. */
export function FeedItem({ item, agent }: { item: SessionItem; agent: string }) {
  switch (item.kind) {
    case "swarm_message":
      return <SwarmMessageBlock item={item} />;
    case "assistant_text":
      return (
        <FeedBlock header={<span className={styles.title}>{agent}</span>} timestamp={item.timestamp}>
          <Markdown source={item.text} />
        </FeedBlock>
      );
    case "user":
      return (
        <FeedBlock header={<span className={styles.title}>Prompt</span>} timestamp={item.timestamp}>
          <RichText text={item.text} />
        </FeedBlock>
      );
    case "thinking":
      return <ThinkingBlock item={item} />;
    case "tool_call":
      return <ToolCallBlock item={item} />;
    case "system":
      return <SystemLine item={item} />;
  }
}
