import { mentionSpans } from "../../../src/mentions";
import { cx } from "../lib/cx";
import { isFileReference, splitFilePaths } from "../lib/filePaths";
import { FileLink } from "./file-preview/FileLink";
import styles from "./RichText.module.css";

/** Mono chip used for file paths and inline code. */
export function InlineCode({ children, interactive = true }: { children: string; interactive?: boolean }) {
  const code = <code className={styles.code}>{children}</code>;
  return interactive && isFileReference(children) ? <FileLink reference={children}>{code}</FileLink> : code;
}

/** Text with detected file paths rendered as InlineCode; the caller controls whitespace. */
export function PathText({ text, interactive = true }: { text: string; interactive?: boolean }) {
  return (
    <>
      {splitFilePaths(text).map((segment, index) =>
        segment.kind === "path" ? (
          <InlineCode key={index} interactive={interactive}>
            {segment.text}
          </InlineCode>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

function mentionParts(text: string, names: readonly string[]) {
  const parts: { text: string; mention: boolean }[] = [];
  let offset = 0;
  for (const span of mentionSpans(text, names)) {
    parts.push({ text: text.slice(offset, span.start), mention: false });
    parts.push({ text: text.slice(span.start, span.end), mention: true });
    offset = span.end;
  }
  parts.push({ text: text.slice(offset), mention: false });
  return parts;
}

export function MentionText({ text, names = [] }: { text: string; names?: readonly string[] }) {
  return (
    <>
      {mentionParts(text, names).map((part, index) =>
        part.mention ? (
          <span key={index} className={styles.mention}>
            {part.text}
          </span>
        ) : (
          <PathText key={index} text={part.text} />
        ),
      )}
    </>
  );
}

interface RichTextProps {
  text: string;
  /** Tone of the body text: secondary for message bodies, primary for emphasised content. */
  tone?: "primary" | "secondary";
  className?: string;
  mentionNames?: readonly string[];
}

/** Plain-text posts, comments and messages: never markdown, newlines preserved. */
export function RichText({ text, tone = "secondary", className, mentionNames = [] }: RichTextProps) {
  return (
    <div className={cx(styles.plain, styles[tone], className)}>
      <MentionText text={text} names={mentionNames} />
    </div>
  );
}
