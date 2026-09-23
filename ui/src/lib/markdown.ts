/** A deliberately small Markdown subset for assistant text in the Work tab. */

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "code"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "rule" };

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST_ITEM = /^\s{0,3}([-*+]|\d{1,9}[.)])\s+(.*)$/;

const isBlockStart = (line: string) =>
  FENCE.test(line) || HEADING.test(line) || RULE.test(line) || LIST_ITEM.test(line);

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    const heading = HEADING.exec(line);
    const item = LIST_ITEM.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) body.push(lines[i++]);
      i += 1;
      blocks.push({ type: "code", text: body.join("\n") });
    } else if (line.trim() === "") {
      i += 1;
    } else if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
    } else if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
    } else if (item) {
      const ordered = /\d/.test(item[1]);
      const items: string[] = [];
      while (i < lines.length && lines[i].trim() !== "") {
        const next = LIST_ITEM.exec(lines[i]);
        if (next && /\d/.test(next[1]) === ordered) items.push(next[2]);
        else if (next || isBlockStart(lines[i]) || items.length === 0) break;
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
    } else {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && (body.length === 0 || !isBlockStart(lines[i]))) {
        body.push(lines[i++]);
      }
      blocks.push({ type: "paragraph", text: body.join("\n") });
    }
  }
  return blocks;
}

const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s](?:[^*]*[^*\s])?)\*|(?<!\w)_([^_\s](?:[^_]*[^_\s])?)_(?!\w)|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g;

const SAFE_HREF = /^(?:https?:|mailto:)/i;

export function parseInline(text: string): Inline[] {
  const nodes: Inline[] = [];
  let last = 0;
  const pushText = (value: string) => {
    if (value) nodes.push({ type: "text", text: value });
  };
  for (const match of text.matchAll(INLINE)) {
    const [whole, , code, strong, strong2, em, em2, linkText, href, url] = match;
    pushText(text.slice(last, match.index));
    last = match.index + whole.length;
    if (code !== undefined) nodes.push({ type: "code", text: code.trim() || code });
    else if (strong !== undefined || strong2 !== undefined)
      nodes.push({ type: "strong", children: parseInline(strong ?? strong2) });
    else if (em !== undefined || em2 !== undefined) nodes.push({ type: "em", children: parseInline(em ?? em2) });
    else if (linkText !== undefined && SAFE_HREF.test(href))
      nodes.push({ type: "link", href, children: parseInline(linkText) });
    else if (linkText !== undefined) nodes.push(...parseInline(linkText));
    else if (url !== undefined) nodes.push({ type: "link", href: url, children: [{ type: "text", text: url }] });
  }
  pushText(text.slice(last));
  return nodes;
}
