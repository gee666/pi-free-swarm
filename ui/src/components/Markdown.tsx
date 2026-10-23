import { lazy, Suspense, useMemo } from "react";
import { codeLanguage } from "../lib/codeLanguages";
import { fileHrefFrom } from "../lib/filePaths";
import { FileLink } from "./file-preview/FileLink";
import { parseInline, parseMarkdown, type Block, type Inline } from "../lib/markdown";
import styles from "./Markdown.module.css";
import { InlineCode, PathText } from "./RichText";

const HighlightedCode = lazy(() => import("./file-preview/HighlightedCode"));

function InlineNodes({
  nodes,
  fileLinks = true,
  fileBase,
}: {
  nodes: Inline[];
  fileLinks?: boolean;
  fileBase?: string;
}) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "text":
            return <PathText key={index} text={node.text} interactive={fileLinks} />;
          case "code":
            return (
              <InlineCode key={index} interactive={fileLinks}>
                {node.text}
              </InlineCode>
            );
          case "strong":
            return (
              <strong key={index} className={styles.strong}>
                <InlineNodes nodes={node.children} fileLinks={fileLinks} fileBase={fileBase} />
              </strong>
            );
          case "em":
            return (
              <em key={index}>
                <InlineNodes nodes={node.children} fileLinks={fileLinks} fileBase={fileBase} />
              </em>
            );
          case "link": {
            const content = <InlineNodes key={index} nodes={node.children} fileLinks={false} />;
            if (!fileLinks) return content;
            return node.local ? (
              <FileLink key={index} reference={fileHrefFrom(node.href, fileBase)}>
                {content}
              </FileLink>
            ) : (
              <a key={index} href={node.href} target="_blank" rel="noreferrer">
                {content}
              </a>
            );
          }
        }
      })}
    </>
  );
}

const inline = (text: string, fileBase?: string) => <InlineNodes nodes={parseInline(text)} fileBase={fileBase} />;

/** Fenced code: --bg-app box that scrolls horizontally. Also used for tool arguments and output. */
export function CodeBlock({ children, language }: { children: string; language?: string }) {
  const plain = (
    <pre className={styles.codeBlock}>
      <code>{children}</code>
    </pre>
  );
  const selected = codeLanguage(language);
  return selected ? (
    <Suspense fallback={plain}>
      <HighlightedCode text={children} language={selected} />
    </Suspense>
  ) : (
    plain
  );
}

function BlockNode({ block, highlightCode, fileBase }: { block: Block; highlightCode: boolean; fileBase?: string }) {
  switch (block.type) {
    case "paragraph":
      return <p className={styles.paragraph}>{inline(block.text, fileBase)}</p>;
    case "heading":
      // Headings stay small inside a feed block: h1/h2 at --fs-h2, the rest at body size.
      return block.level <= 2 ? (
        <h3 className={styles.headingLarge}>{inline(block.text, fileBase)}</h3>
      ) : (
        <h4 className={styles.headingSmall}>{inline(block.text, fileBase)}</h4>
      );
    case "code":
      return <CodeBlock language={highlightCode ? block.language : undefined}>{block.text}</CodeBlock>;
    case "list": {
      const items = block.items.map((item, index) => <li key={index}>{inline(item, fileBase)}</li>);
      return block.ordered ? <ol className={styles.list}>{items}</ol> : <ul className={styles.list}>{items}</ul>;
    }
    case "rule":
      return <hr className={styles.rule} />;
  }
}

function splitAttachmentFooter(source: string): { body: string; reference?: string } {
  const marker = "… [full text: ";
  const at = source.endsWith("]") ? source.lastIndexOf(marker) : -1;
  if (at < 0) return { body: source };
  const reference = source.slice(at + marker.length, -1);
  if (!reference.trim() || /[\r\n]/.test(reference)) return { body: source };
  return { body: source.slice(0, at), reference };
}

/** Safe message Markdown; generated attachment metadata stays outside an unfinished code fence. */
export function Markdown({
  source,
  highlightCode = false,
  fileBase,
  renderAttachmentFooter = true,
}: {
  source: string;
  highlightCode?: boolean;
  fileBase?: string;
  renderAttachmentFooter?: boolean;
}) {
  const { blocks, reference } = useMemo(() => {
    const parts = renderAttachmentFooter ? splitAttachmentFooter(source) : { body: source, reference: undefined };
    return { blocks: parseMarkdown(parts.body), reference: parts.reference };
  }, [source, renderAttachmentFooter]);
  return (
    <div className={styles.markdown}>
      {blocks.map((block, index) => (
        <BlockNode key={index} block={block} highlightCode={highlightCode} fileBase={fileBase} />
      ))}
      {reference !== undefined && (
        <p className={styles.paragraph}>
          {"… [full text: "}
          <FileLink reference={reference}>
            <InlineCode interactive={false}>{reference}</InlineCode>
          </FileLink>
          {"]"}
        </p>
      )}
    </div>
  );
}
