import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ComposeBox, SWARM_NOT_RUNNING_NOTICE } from "./ComposeBox";

interface HarnessProps {
  onSend?: (text: string, to: string) => void;
  initialText?: string;
  withRecipients?: boolean;
  disabled?: boolean;
}

function Harness({ onSend = () => undefined, initialText = "", withRecipients = true, disabled }: HarnessProps) {
  const [text, setText] = useState(initialText);
  const [to, setTo] = useState("Maria");
  return (
    <ComposeBox
      text={text}
      onTextChange={setText}
      onSend={() => onSend(text, to)}
      attachmentThreshold={10}
      disabled={disabled}
      recipients={withRecipients ? { name: to, options: ["Maria", "John", "Liam"], onChange: setTo } : undefined}
    />
  );
}

const textbox = () => screen.getByRole("textbox", { name: "Type a message…" });
const sendButton = () => screen.getByRole("button", { name: "Send" });

describe("ComposeBox", () => {
  it("counts characters without blocking longer User text", async () => {
    render(<Harness />);
    expect(screen.queryByText("0/10")).not.toBeInTheDocument();
    expect(textbox()).toHaveAttribute("rows", "1");
    expect(sendButton()).toBeDisabled();
    await userEvent.type(textbox(), "hello");
    expect(screen.queryByText("5/10")).not.toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
    await userEvent.type(textbox(), " wo");
    expect(screen.getByText("8/10")).toBeInTheDocument();
    await userEvent.type(textbox(), "rld!");
    expect(screen.getByText("12/10")).toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
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
    expect(onSend).toHaveBeenLastCalledWith("hi\nthere", "Maria");
  });

  it("puts the shortcut in the send tooltip, not the composer", async () => {
    render(<Harness initialText="hi" />);
    expect(screen.queryByText(/Press.*Enter/)).not.toBeInTheDocument();
    expect(sendButton()).toHaveTextContent("");
    await userEvent.hover(sendButton());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Send (Ctrl+Enter)");
  });

  it("disables everything and explains why when the swarm is not running", () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} initialText="hello" disabled />);
    expect(textbox()).toHaveAttribute("placeholder", SWARM_NOT_RUNNING_NOTICE);
    expect(screen.queryByText(SWARM_NOT_RUNNING_NOTICE)).not.toBeInTheDocument();
    expect(textbox()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Recipient" })).toBeDisabled();
  });

  it("selects exactly one recipient and disables send without one", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} initialText="hello" />);
    const recipient = screen.getByRole("combobox", { name: "Recipient" });
    expect(recipient).not.toHaveAttribute("multiple");
    await userEvent.selectOptions(recipient, "Liam");
    await userEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledWith("hello", "Liam");
    await userEvent.selectOptions(recipient, "");
    expect(sendButton()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "add agent" })).not.toBeInTheDocument();
  });

  it("warns near the preview allowance but accepts longer text", () => {
    render(
      <ComposeBox
        text={"x".repeat(201)}
        onTextChange={() => undefined}
        onSend={() => undefined}
        attachmentThreshold={200}
      />,
    );
    expect(screen.getByText("201/200")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Over 200 characters, the full text is saved to a file");
    expect(sendButton()).toBeEnabled();
  });

  it("has no To row in the wall comment variant", () => {
    render(<Harness withRecipients={false} />);
    expect(screen.queryByText("To:")).not.toBeInTheDocument();
  });
});
