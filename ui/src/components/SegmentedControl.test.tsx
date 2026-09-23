import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

function Mailbox() {
  const [box, setBox] = useState<"inbox" | "sent">("inbox");
  return (
    <SegmentedControl
      label="Mailbox"
      value={box}
      onChange={setBox}
      options={[
        { value: "inbox", label: "Inbox (3)" },
        { value: "sent", label: "Sent" },
      ]}
    />
  );
}

describe("SegmentedControl", () => {
  it("marks the active segment and switches on click", async () => {
    render(<Mailbox />);
    expect(screen.getByRole("radio", { name: "Inbox (3)" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Sent" }));
    expect(screen.getByRole("radio", { name: "Sent" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Inbox (3)" })).not.toBeChecked();
  });

  it("moves with the arrow keys", async () => {
    render(<Mailbox />);
    screen.getByRole("radio", { name: "Inbox (3)" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Sent" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Sent" })).toHaveFocus();
  });
});
