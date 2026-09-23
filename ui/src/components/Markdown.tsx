import { useMemo } from "react";
import { parseInline, parseMarkdown, type Block, type Inline } from "../lib/markdown";
import styles from "./Markdown.module.css";
import { InlineCode, PathText } from "./RichText";

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "text":
            return <PathText key={index} text={node.text} />;
          case "code":
            return <InlineCode key={index}>{node.text}</InlineCode>;
          case "strong":
            return (
              <strong key={index} className={styles.strong}>
                <InlineNodes nodes={node.children} />
              </strong>
            );
          case "em":
            return (
              <em key={index}>
                <InlineNodes nodes={node.children} />
              </em>
            );
          case "link":
            return (
              <a key={index} href={node.href} target="_blank" rel="noreferrer">
                <InlineNodes nodes={node.children} />
              </a>
            );
        }
      })}
    </>
  );
}

const inline = (text: string) => <InlineNodes nodes={parseInline(text)} />;

/** Fenced code: --bg-app box that scrolls horizontally. Also used for tool arguments and output. */
export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className={styles.codeBlock}>
      <code>{children}</code>
    </pre>
  );
}

function BlockNode({ block }: { block: Block }) {
  switch (block.type) {
    case "paragraph":
      return <p className={styles.paragraph}>{inline(block.text)}</p>;
    case "heading":
      // Headings stay small inside a feed block: h1/h2 at --fs-h2, the rest at body size.
      return block.level <= 2 ? (
        <h3 className={styles.headingLarge}>{inline(block.text)}</h3>
      ) : (
        <h4 className={styles.headingSmall}>{inline(block.text)}</h4>
      );
    case "code":
      return <CodeBlock>{block.text}</CodeBlock>;
    case "list": {
      const items = block.items.map((item, index) => <li key={index}>{inline(item)}</li>);
      return block.ordered ? <ol className={styles.list}>{items}</ol> : <ul className={styles.list}>{items}</ul>;
    }
    case "rule":
      return <hr className={styles.rule} />;
  }
}

/** Assistant text in the Work tab. Renders React elements only, never raw HTML. */
export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className={styles.markdown}>
      {blocks.map((block, index) => (
        <BlockNode key={index} block={block} />
      ))}
    </div>
  );
}
