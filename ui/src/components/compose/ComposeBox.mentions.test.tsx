import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ComposeBox } from "./ComposeBox";

function Harness({
  names = ["Maria", "Mark", "John"],
  onSend = () => undefined,
  disabled = false,
}: {
  names?: readonly string[];
  onSend?: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  return (
    <ComposeBox
      text={text}
      onTextChange={setText}
      onSend={() => onSend(text)}
      mentionNames={names}
      disabled={disabled}
    />
  );
}

const textbox = () => screen.getByRole("textbox", { name: "Type a message…" });

describe("ComposeBox mentions", () => {
  it("filters existing names case-insensitively after @", async () => {
    render(<Harness />);
    await userEvent.type(textbox(), "Hello @mA");
    const list = screen.getByRole("listbox", { name: "Mention an agent" });
    expect(textbox()).toHaveAttribute("aria-controls", list.id);
    expect(textbox()).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0].id);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["@Maria", "@Mark"]);
    expect(screen.queryByRole("option", { name: "@John" })).not.toBeInTheDocument();
  });

  it("selects a suggestion by keyboard without sending", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    await userEvent.type(textbox(), "Ask @ma");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(textbox()).toHaveValue("Ask @Mark ");
    expect(textbox()).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onSend).toHaveBeenCalledWith("Ask @Mark ");
  });

  it("inserts a clicked suggestion and keeps the composer focused", async () => {
    render(<Harness />);
    await userEvent.type(textbox(), "@jo");
    await userEvent.click(screen.getByRole("option", { name: "@John" }));
    expect(textbox()).toHaveValue("@John ");
    expect(textbox()).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("accepts a suggestion with Tab without sending", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    await userEvent.type(textbox(), "@jo");
    await userEvent.tab();
    expect(textbox()).toHaveValue("@John ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("dismisses suggestions with Escape without changing text", async () => {
    render(<Harness />);
    await userEvent.type(textbox(), "@ma");
    await userEvent.keyboard("{Escape}");
    expect(textbox()).toHaveValue("@ma");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not suggest unknown names or email fragments", async () => {
    render(<Harness />);
    await userEvent.type(textbox(), "@nobody");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await userEvent.clear(textbox());
    await userEvent.type(textbox(), "hello@ma");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keeps ordinary typing unchanged when no agents are available", async () => {
    render(<Harness names={[]} />);
    await userEvent.type(textbox(), "@ma");
    expect(textbox()).toHaveValue("@ma");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
