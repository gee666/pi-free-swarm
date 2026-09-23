import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders headings, paragraphs, lists and code", () => {
    const source = [
      "# Title",
      "",
      "Some **bold** and *em* with `code`.",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "",
      "```ts",
      "const x = 1 < 2;",
      "```",
    ].join("\n");
    const { container } = render(<Markdown source={source} />);
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("em")).toHaveTextContent("em");
    expect(container.querySelector("p code")).toHaveTextContent("code");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(1);
    expect(container.querySelector("pre")).toHaveTextContent("const x = 1 < 2;");
  });

  it("links only safe URLs and never renders raw HTML", () => {
    const source = "[docs](https://example.com) [bad](javascript:alert(1)) <b>raw</b> https://pi.dev/x.";
    const { container } = render(<Markdown source={source} />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://example.com", "https://pi.dev/x"]);
    expect(container.querySelector("b")).toBeNull();
    expect(container).toHaveTextContent("<b>raw</b>");
    expect(container).toHaveTextContent("bad");
  });
});
