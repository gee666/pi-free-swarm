import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SessionItem, SessionToolCallItem } from "../../../../src/api-types";
import { FeedItem } from "./FeedItem";
import { TOOL_TEXT_PREVIEW_CHARS } from "./toolText";

const timestamp = new Date().setHours(10, 24, 0, 0);

const toolCall = (patch: Partial<SessionToolCallItem> = {}): SessionToolCallItem => ({
  kind: "tool_call",
  id: "e1:0",
  timestamp,
  toolCallId: "call_1",
  name: "bash",
  args: { command: "npm test -- auth", timeout: 120 },
  result: "ok",
  resultTruncated: false,
  isError: false,
  durationMs: 12_400,
  ...patch,
});

const renderItem = (item: SessionItem) => render(<FeedItem item={item} agent="John" />);

describe("FeedItem", () => {
  it("renders a delivered swarm message with its thread header and plain text", () => {
    renderItem({
      kind: "swarm_message",
      id: "e1:0",
      timestamp,
      messageId: 41,
      threadId: 12,
      from: "Maria",
      to: ["John", "You"],
      text: "See docs/prd-auth.md\n**not bold**",
    });
    const block = screen.getByRole("article");
    expect(block).toHaveTextContent("thread #12 · fromMaria· to: John, You");
    expect(within(block).getByText("docs/prd-auth.md").tagName).toBe("CODE");
    expect(within(block).queryByRole("strong")).toBeNull();
    expect(block).toHaveTextContent("**not bold**");
    expect(within(block).getByText("10:24 AM")).toBeInTheDocument();
    expect(block.className).toMatch(/marked/);
  });

  it("renders assistant text as markdown under the agent's name", () => {
    renderItem({ kind: "assistant_text", id: "e1:0", timestamp, text: "## Plan\n\n```ts\nconst x = 1;\n```" });
    expect(screen.getByText("John")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
    expect(document.querySelector("pre")).toHaveTextContent("const x = 1;");
  });

  it("renders a user prompt as plain text", () => {
    renderItem({ kind: "user", id: "e0:0", timestamp, text: "You are John.\n# not a heading" });
    expect(screen.getByText("Prompt")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "not a heading" })).toBeNull();
  });

  it("keeps thinking collapsed to its first line until opened", async () => {
    renderItem({ kind: "thinking", id: "e1:0", timestamp, text: "\nFirst idea.\nSecond idea." });
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle).toHaveTextContent("ThinkingFirst idea.");
    expect(screen.queryByText(/Second idea/)).toBeNull();
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(screen.getByText(/Second idea/)).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText(/Second idea/)).toBeNull();
  });

  it("summarises a tool call and shows arguments and output when expanded", async () => {
    renderItem(toolCall());
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle).toHaveTextContent("bash");
    expect(toggle).toHaveTextContent("npm test -- auth");
    expect(toggle).toHaveTextContent("12s");
    expect(screen.queryByText("Arguments")).toBeNull();
    await userEvent.click(toggle);
    const [args, output] = document.querySelectorAll("pre");
    expect(args).toHaveTextContent('"timeout": 120');
    expect(output).toHaveTextContent("ok");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    expect(screen.getByRole("article").className).not.toMatch(/marked/);
  });

  it("cuts long output at 4 KB until Show more is clicked", async () => {
    const result = `${"a".repeat(TOOL_TEXT_PREVIEW_CHARS)}TAIL`;
    renderItem(toolCall({ result, resultTruncated: true }));
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    const output = () => document.querySelectorAll("pre")[1];
    expect(output().textContent).toHaveLength(TOOL_TEXT_PREVIEW_CHARS + 1);
    expect(output()).not.toHaveTextContent("TAIL");
    expect(screen.queryByText(/cut by the board server/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(output()).toHaveTextContent(/TAIL$/);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    expect(screen.getByText(/cut by the board server/)).toBeInTheDocument();
  });

  it("marks a failed call with the pink bar and a failed pill", () => {
    renderItem(toolCall({ isError: true, durationMs: 40 }));
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("40ms")).toBeInTheDocument();
    expect(screen.getByRole("article").className).toMatch(/marked/);
  });

  it("shows a running call without output yet", async () => {
    renderItem(toolCall({ result: null, durationMs: null }));
    expect(screen.getByText("running…")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Running…")).toBeInTheDocument();
  });

  it("renders system events as one centered line, errors in pink", () => {
    const { rerender } = renderItem({
      kind: "system",
      id: "e1:0",
      timestamp,
      event: "compaction",
      text: "Context compacted",
    });
    const line = screen.getByRole("note");
    expect(line).toHaveTextContent("Context compacted · 10:24 AM");
    expect(line.className).not.toMatch(/error/);
    rerender(
      <FeedItem item={{ kind: "system", id: "e1:0", timestamp, event: "error", text: "Aborted" }} agent="John" />,
    );
    expect(screen.getByRole("note").className).toMatch(/error/);
  });
});
