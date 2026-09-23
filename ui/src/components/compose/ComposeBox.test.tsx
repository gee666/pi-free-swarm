import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ComposeBox, SWARM_NOT_RUNNING_NOTICE } from "./ComposeBox";

interface HarnessProps {
  onSend?: (text: string, to: readonly string[]) => void;
  initialText?: string;
  withRecipients?: boolean;
  disabled?: boolean;
  thread?: boolean;
}

function Harness({
  onSend = () => undefined,
  initialText = "",
  withRecipients = true,
  disabled,
  thread,
}: HarnessProps) {
  const [text, setText] = useState(initialText);
  const [to, setTo] = useState<string[]>(["Maria"]);
  return (
    <ComposeBox
      text={text}
      onTextChange={setText}
      onSend={() => onSend(text, to)}
      limit={10}
      disabled={disabled}
      thread={thread ? { id: 12, onCancel: () => undefined } : undefined}
      recipients={withRecipients ? { names: to, options: ["Maria", "John", "Liam"], onChange: setTo } : undefined}
    />
  );
}

const textbox = () => screen.getByRole("textbox", { name: "Type a message…" });
const sendButton = () => screen.getByRole("button", { name: "Send" });

describe("ComposeBox", () => {
  it("counts characters and blocks sending above the limit", async () => {
    render(<Harness />);
    expect(screen.getByText("0/10")).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    await userEvent.type(textbox(), "hello");
    expect(screen.getByText("5/10")).toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
    await userEvent.type(textbox(), " world!");
    expect(screen.getByText("12/10")).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it("sends with Ctrl+Enter and ⌘+Enter, while plain Enter adds a newline", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    await userEvent.type(textbox(), "hi{Enter}there");
    expect(textbox()).toHaveValue("hi\nthere");
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenLastCalledWith("hi\nthere", ["Maria"]);
  });

  it("shows the Ctrl hint outside Apple platforms", () => {
    render(<Harness />);
    expect(screen.getByText("Press Ctrl Enter to send")).toBeInTheDocument();
  });

  it("disables everything and explains why when the swarm is not running", () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} initialText="hello" disabled />);
    expect(screen.getByText(SWARM_NOT_RUNNING_NOTICE)).toBeInTheDocument();
    expect(textbox()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove Maria" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "add agent" })).toBeDisabled();
  });

  it("removes chips and adds agents through the autocomplete", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} initialText="hello" />);
    await userEvent.click(screen.getByRole("button", { name: "add agent" }));
    const search = screen.getByRole("combobox", { name: "Find an agent" });
    expect(search).toHaveFocus();
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["John", "Liam"]);
    await userEvent.type(search, "li");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Liam"]);
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove Maria" }));
    await userEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledWith("hello", ["Liam"]);

    await userEvent.click(screen.getByRole("button", { name: "Remove Liam" }));
    expect(sendButton()).toBeDisabled();
  });

  it("makes thread members read-only in thread mode", () => {
    render(<Harness thread />);
    expect(screen.getByText("Replying in thread #12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel reply" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Remove Maria" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "add agent" })).not.toBeInTheDocument();
  });

  it("has no To row in the wall comment variant", () => {
    render(<Harness withRecipients={false} />);
    expect(screen.queryByText("To:")).not.toBeInTheDocument();
  });
});
