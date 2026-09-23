import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { splitFilePaths } from "../lib/filePaths";
import { RichText } from "./RichText";

const paths = (text: string) =>
  splitFilePaths(text)
    .filter((segment) => segment.kind === "path")
    .map((segment) => segment.text);

describe("file path detection", () => {
  it("finds relative, absolute and line-suffixed paths", () => {
    expect(paths("See src/auth/token.ts and docs/prd.md.")).toEqual(["src/auth/token.ts", "docs/prd.md"]);
    expect(paths("Open ./ui/App.tsx, /etc/hosts.conf or ~/notes/todo.txt")).toEqual([
      "./ui/App.tsx",
      "/etc/hosts.conf",
      "~/notes/todo.txt",
    ]);
    expect(paths("Fails at test/broker/messages.test.ts:42:7")).toEqual(["test/broker/messages.test.ts:42:7"]);
  });

  it("ignores URLs, fractions, bare file names and slashes in prose", () => {
    expect(paths("Docs at https://example.com/guide/index.html")).toEqual([]);
    expect(paths("Use 1/2.5 of the budget, and/or Node.js")).toEqual([]);
  });
});

describe("RichText", () => {
  it("keeps the text and newlines and wraps paths in code", () => {
    const { container } = render(<RichText text={"Hi,\nsee src/a/b.ts now"} />);
    expect(container.textContent).toBe("Hi,\nsee src/a/b.ts now");
    expect(container.querySelector("code")).toHaveTextContent("src/a/b.ts");
  });
});
