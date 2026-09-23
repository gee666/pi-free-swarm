import type { KeyboardEvent } from "react";
import { Info, Reply, Send, X } from "lucide-react";
import { checkText } from "../../../../src/limits";
import { cx } from "../../lib/cx";
import { sendModifierLabel } from "../../lib/platform";
import { Button, IconButton } from "../Button";
import { AutoTextarea, CharCounter } from "../Field";
import { Icon } from "../Icon";
import { Panel } from "../Panel";
import styles from "./Compose.module.css";
import { RecipientField } from "./RecipientField";

export const SWARM_NOT_RUNNING_NOTICE = "Swarm is not running. Messages can't be sent.";

export interface ComposeRecipients {
  names: readonly string[];
  /** Every participant that may be added via "+ add agent". */
  options: readonly string[];
  onChange: (names: string[]) => void;
}

export interface ComposeThread {
  id: number;
  onCancel: () => void;
}

export interface ComposeBoxProps {
  text: string;
  onTextChange: (text: string) => void;
  /** Called by the button and by ⌘/Ctrl+Enter, only when the text is sendable. */
  onSend: () => void;
  /** Character limit shown as "n/limit"; sending is blocked above it. */
  limit: number;
  /** Omit for the wall comment variant without a "To" row. */
  recipients?: ComposeRecipients;
  /** Thread mode: "Replying in thread #id" with cancel; chips become read-only. */
  thread?: ComposeThread;
  placeholder?: string;
  sendLabel?: string;
  /** Swarm not running: everything is disabled and the notice is shown. */
  disabled?: boolean;
  disabledNotice?: string;
  /** A send request is in flight. */
  busy?: boolean;
}

export function ComposeBox({
  text,
  onTextChange,
  onSend,
  limit,
  recipients,
  thread,
  placeholder = "Type a message…",
  sendLabel = "Send",
  disabled = false,
  disabledNotice = SWARM_NOT_RUNNING_NOTICE,
  busy = false,
}: ComposeBoxProps) {
  const hasRecipients = recipients === undefined || recipients.names.length > 0;
  const canSend = !disabled && !busy && hasRecipients && checkText(text, limit).ok;
  const send = () => {
    if (canSend) onSend();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    send();
  };
  const hint = <span className={styles.hint}>Press {sendModifierLabel()} Enter to send</span>;

  return (
    <Panel className={styles.compose} aria-label="Compose">
      {disabled && (
        <p className={styles.notice}>
          <Icon icon={Info} size="status" />
          {disabledNotice}
        </p>
      )}
      <div className={cx(styles.controls, disabled && styles.dimmed)}>
        {thread && (
          <div className={styles.threadLine}>
            <Icon icon={Reply} size="status" />
            Replying in thread #{thread.id}
            <IconButton icon={X} label="Cancel reply" onClick={thread.onCancel} />
          </div>
        )}
        {recipients && (
          <RecipientField
            names={recipients.names}
            options={recipients.options}
            onChange={recipients.onChange}
            readOnly={thread !== undefined}
            disabled={disabled}
            hint={hint}
          />
        )}
        <AutoTextarea
          value={text}
          onChange={onTextChange}
          label={placeholder}
          placeholder={placeholder}
          disabled={disabled}
          onKeyDown={onKeyDown}
        />
        <div className={styles.footer}>
          {!recipients && hint}
          <span className={styles.spacer} />
          <CharCounter text={text} limit={limit} />
          <Button variant="primary" icon={Send} disabled={!canSend} onClick={send}>
            {sendLabel}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
