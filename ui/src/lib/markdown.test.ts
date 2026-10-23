import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("bounded simple Markdown parsing", () => {
  it("preserves malformed full-page delimiter runs as literal text", () => {
    for (const source of ["a" + "`".repeat(65535), "[".repeat(65536), "[a".repeat(32768), "[a](".repeat(16384)]) {
      expect(parseInline(source)).toEqual([{ type: "text", text: source }]);
    }
  });
  it("keeps valid multi-backtick spans and explicit fenced languages", () => {
    expect(parseInline("``a`b``")).toEqual([{ type: "code", text: "a`b" }]);
    expect(parseMarkdown("```ts\nconst value = 1;\n```")).toEqual([
      { type: "code", text: "const value = 1;", language: "ts" },
    ]);
  });
  it("retains local targets independently of filename heuristics and rejects unsafe schemes", () => {
    const nodes = parseInline("[env](.env) [run](scripts/run) [notes](docs/my%20notes.md)");
    expect(nodes.filter((node) => node.type === "link")).toEqual([
      { type: "link", href: ".env", local: true, children: [{ type: "text", text: "env" }] },
      { type: "link", href: "scripts/run", local: true, children: [{ type: "text", text: "run" }] },
      { type: "link", href: "docs/my notes.md", local: true, children: [{ type: "text", text: "notes" }] },
    ]);
    const unsafe = parseInline("[bad](javascript:alert(1)) [data](data:text/html,evil) [host](//evil.test/a.md)");
    expect(unsafe.some((node) => node.type === "link")).toBe(false);
  });
});
