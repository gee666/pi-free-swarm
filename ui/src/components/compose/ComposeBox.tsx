import type { KeyboardEvent, ReactNode } from "react";
import { Reply, Send, X } from "lucide-react";
import { checkText } from "../../../../src/limits";
import { cx } from "../../lib/cx";
import { sendModifierLabel } from "../../lib/platform";
import { IconButton } from "../Button";
import { AutoTextarea, CharCounter } from "../Field";
import { Icon } from "../Icon";
import { Tooltip } from "../Tooltip";
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
  /** Sending is blocked above this character limit. */
  limit: number;
  /** Omit for the wall comment variant without a "To" row. */
  recipients?: ComposeRecipients;
  /** Thread mode: "Replying in thread #id" with cancel; chips become read-only. */
  thread?: ComposeThread;
  placeholder?: string;
  sendLabel?: string;
  /** Swarm not running: controls are disabled. */
  disabled?: boolean;
  disabledNotice?: string;
  /** A send request is in flight. */
  busy?: boolean;
  sendDisabled?: boolean;
  textareaLabel?: string;
  children?: ReactNode;
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
  sendDisabled = false,
  textareaLabel,
  children,
}: ComposeBoxProps) {
  const hasRecipients = recipients === undefined || recipients.names.length > 0;
  const canSend = !disabled && !busy && !sendDisabled && hasRecipients && checkText(text, limit).ok;
  const send = () => {
    if (canSend) onSend();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    send();
  };

  return (
    <section className={styles.compose} aria-label="Compose">
      <div className={cx(styles.controls, disabled && styles.dimmed)}>
        {children}
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
          />
        )}
        <AutoTextarea
          value={text}
          onChange={onTextChange}
          label={textareaLabel ?? placeholder}
          placeholder={disabled ? disabledNotice : placeholder}
          disabled={disabled}
          onKeyDown={onKeyDown}
        />
        <div className={styles.footer}>
          <CharCounter text={text} limit={limit} />
          <Tooltip content={`Send (${sendModifierLabel()}+Enter)`}>
            <IconButton icon={Send} label={sendLabel} className={styles.send} disabled={!canSend} onClick={send} />
          </Tooltip>
        </div>
      </div>
    </section>
  );
}
