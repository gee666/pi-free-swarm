import { useMemo, type ReactNode } from "react";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import sql from "highlight.js/lib/languages/sql";
import codeStyles from "../Markdown.module.css";
import styles from "./FilePreview.module.css";

const languages = { javascript, typescript, json, python, bash, css, xml, yaml, sql };
for (const [name, grammar] of Object.entries(languages)) hljs.registerLanguage(name, grammar);

/** Keep only text and span classes from the highlighter, never arbitrary HTML elements or attributes. */
function token(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element) || node.tagName !== "SPAN") return node.textContent;
  return (
    <span key={key} className={node.getAttribute("class") ?? undefined}>
      {Array.from(node.childNodes, token)}
    </span>
  );
}

export default function HighlightedCode({ text, language }: { text: string; language: string }) {
  const content = useMemo(() => {
    const html = hljs.highlight(text, { language, ignoreIllegals: true }).value;
    const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const fragment = parsed.body.firstElementChild;
    return fragment ? Array.from(fragment.childNodes, token) : text;
  }, [text, language]);
  return (
    <pre className={codeStyles.codeBlock}>
      <code className={styles.highlighted} data-language={language}>
        {content}
      </code>
    </pre>
  );
}
