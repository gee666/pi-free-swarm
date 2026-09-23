import { useState } from "react";
import { Wrench } from "lucide-react";
import type { SessionToolCallItem } from "../../../../src/api-types";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { CodeBlock } from "../../components/Markdown";
import { Pill } from "../../components/Pill";
import { FeedBlock } from "./FeedBlock";
import styles from "./FeedBlock.module.css";
import { argsSummary, argsText, formatToolDuration, TOOL_TEXT_PREVIEW_CHARS } from "./toolText";

/** Code block cut at the preview size, with "Show more" for the rest; `endNote` follows the full text. */
function PreviewCode({ text, endNote }: { text: string; endNote?: string }) {
  const [full, setFull] = useState(false);
  const cut = !full && text.length > TOOL_TEXT_PREVIEW_CHARS;
  return (
    <>
      <CodeBlock>{cut ? `${text.slice(0, TOOL_TEXT_PREVIEW_CHARS)}…` : text}</CodeBlock>
      {cut ? (
        <Button size="sm" onClick={() => setFull(true)}>
          Show more
        </Button>
      ) : (
        endNote && <p className={styles.note}>{endNote}</p>
      )}
    </>
  );
}

function ToolOutput({ item }: { item: SessionToolCallItem }) {
  if (item.result === null) return <p className={styles.note}>Running…</p>;
  if (item.result === "") return <p className={styles.note}>No output</p>;
  const endNote = item.resultTruncated ? "The rest of the output was cut by the board server." : undefined;
  return <PreviewCode text={item.result} endNote={endNote} />;
}

export function ToolCallBlock({ item }: { item: SessionToolCallItem }) {
  const [expanded, setExpanded] = useState(false);
  const header = (
    <>
      <Icon icon={Wrench} className={styles.icon} />
      <span className={styles.toolName}>{item.name}</span>
      <span className={styles.summary}>{argsSummary(item.args)}</span>
      {item.isError && <Pill>failed</Pill>}
      <span className={styles.duration}>
        {item.durationMs === null ? "running…" : formatToolDuration(item.durationMs)}
      </span>
    </>
  );
  return (
    <FeedBlock
      header={header}
      timestamp={item.timestamp}
      marked={item.isError}
      toggle={{ expanded, onToggle: () => setExpanded((value) => !value) }}
    >
      {expanded && (
        <>
          <section className={styles.section}>
            <h4 className={styles.sectionLabel}>Arguments</h4>
            <PreviewCode text={argsText(item.args)} />
          </section>
          <section className={styles.section}>
            <h4 className={styles.sectionLabel}>Output</h4>
            <ToolOutput item={item} />
          </section>
        </>
      )}
    </FeedBlock>
  );
}
