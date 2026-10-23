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

interface RichTextProps {
  text: string;
  /** Tone of the body text: secondary for message bodies, primary for emphasised content. */
  tone?: "primary" | "secondary";
  className?: string;
}

/** Plain-text posts, comments and messages: never markdown, newlines preserved. */
export function RichText({ text, tone = "secondary", className }: RichTextProps) {
  return (
    <div className={cx(styles.plain, styles[tone], className)}>
      <PathText text={text} />
    </div>
  );
}
