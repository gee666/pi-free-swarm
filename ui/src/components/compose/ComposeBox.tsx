import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Paperclip, Send } from "lucide-react";
import { charCount, checkText } from "../../../../src/limits";
import { cx } from "../../lib/cx";
import { sendModifierLabel } from "../../lib/platform";
import { IconButton } from "../Button";
import { AutoTextarea, CharCounter } from "../Field";
import { Tooltip } from "../Tooltip";
import styles from "./Compose.module.css";
import { RecipientField } from "./RecipientField";
import { MentionTextarea } from "./MentionTextarea";
import { useComposerUploads } from "./useComposerUploads";
import { ErrorBanner } from "../States";

export const SWARM_NOT_RUNNING_NOTICE = "Swarm is not running. Messages can't be sent.";

export interface ComposeRecipients {
  name: string;
  options: readonly string[];
  onChange: (name: string) => void;
}

export interface ComposeBoxProps {
  text: string;
  onTextChange: (text: string) => void;
  /** Called by the button and by ⌘/Ctrl+Enter, only when the text is sendable. */
  onSend: () => void;
  /** Omit for the wall comment variant without a "To" row. */
  recipients?: ComposeRecipients;
  placeholder?: string;
  sendLabel?: string;
  /** Swarm not running: controls are disabled. */
  disabled?: boolean;
  disabledNotice?: string;
  /** A send request is in flight. */
  busy?: boolean;
  sendDisabled?: boolean;
  textareaLabel?: string;
  mentionNames?: readonly string[];
  attachmentThreshold?: number;
  uploadSwarmId?: string;
  uploadScope?: string;
  children?: ReactNode;
}

export function ComposeBox({
  text,
  onTextChange,
  onSend,
  recipients,
  placeholder = "Type a message…",
  sendLabel = "Send",
  disabled = false,
  disabledNotice = SWARM_NOT_RUNNING_NOTICE,
  busy = false,
  sendDisabled = false,
  textareaLabel,
  mentionNames,
  attachmentThreshold,
  uploadSwarmId,
  uploadScope,
  children,
}: ComposeBoxProps) {
  const controls = useRef<HTMLDivElement>(null);
  const uploads = useComposerUploads({
    swarmId: uploadSwarmId,
    scope: uploadScope,
    text,
    onChange: onTextChange,
    controls,
    disabled: disabled || busy,
  });
  const hasRecipients = recipients === undefined || recipients.name.length > 0;
  const characterCount = charCount(text);
  const canSend =
    !disabled && !busy && !uploads.uploading && !sendDisabled && hasRecipients && checkText(text, Infinity).ok;
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
      <div
        ref={controls}
        onPaste={uploads.onPaste}
        className={cx(styles.controls, uploadSwarmId && styles.withUploads, disabled && styles.dimmed)}
      >
        {children}
        {recipients && (
          <RecipientField
            name={recipients.name}
            options={recipients.options}
            onChange={recipients.onChange}
            disabled={disabled}
          />
        )}
        {mentionNames ? (
          <MentionTextarea
            value={text}
            onChange={onTextChange}
            names={mentionNames}
            label={textareaLabel ?? placeholder}
            placeholder={disabled ? disabledNotice : placeholder}
            disabled={disabled}
            onKeyDown={onKeyDown}
          />
        ) : (
          <AutoTextarea
            value={text}
            onChange={onTextChange}
            label={textareaLabel ?? placeholder}
            placeholder={disabled ? disabledNotice : placeholder}
            disabled={disabled}
            onKeyDown={onKeyDown}
          />
        )}
        {uploadSwarmId && (
          <input
            ref={uploads.picker}
            type="file"
            multiple
            hidden
            aria-label="Upload files"
            disabled={disabled || busy || uploads.uploading}
            onChange={uploads.onFileChange}
          />
        )}
        <div className={styles.footer}>
          {uploadSwarmId && (
            <Tooltip content="Attach file">
              <IconButton
                icon={Paperclip}
                label="Attach file"
                disabled={disabled || busy || uploads.uploading}
                onClick={() => uploads.picker.current?.click()}
              />
            </Tooltip>
          )}
          {attachmentThreshold !== undefined && <CharCounter text={text} limit={attachmentThreshold} />}
          <Tooltip content={`Send (${sendModifierLabel()}+Enter)`}>
            <IconButton icon={Send} label={sendLabel} className={styles.send} disabled={!canSend} onClick={send} />
          </Tooltip>
        </div>
      </div>
      {uploads.uploading && (
        <p role="status" className={styles.attachmentNotice}>
          Uploading files…
        </p>
      )}
      {uploads.error && <ErrorBanner>{`File upload failed: ${uploads.error}`}</ErrorBanner>}
      {attachmentThreshold !== undefined && characterCount >= attachmentThreshold && (
        <p role="status" className={styles.attachmentNotice}>
          Over {attachmentThreshold} characters, the full text is saved to a file
        </p>
      )}
    </section>
  );
}
