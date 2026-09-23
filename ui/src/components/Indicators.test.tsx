import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CountBadge, UnreadDot } from "./Indicators";

describe("CountBadge", () => {
  it("renders nothing at 0", () => {
    const { container } = render(<CountBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the number up to 9 and 9+ above", () => {
    render(<CountBadge count={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    render(<CountBadge count={12} />);
    expect(screen.getByText("9+")).toBeInTheDocument();
    expect(screen.getByText("12 unread")).toBeInTheDocument();
  });

  it("keeps an empty slot at 0 when asked to reserve space", () => {
    const { container } = render(<CountBadge count={0} reserveSpace />);
    expect(container.firstChild).toBeEmptyDOMElement();
  });
});

describe("UnreadDot", () => {
  it("announces unread and keeps the slot when read", () => {
    const { container, rerender } = render(<UnreadDot unread />);
    expect(screen.getByText("Unread")).toBeInTheDocument();
    rerender(<UnreadDot unread={false} />);
    expect(screen.queryByText("Unread")).not.toBeInTheDocument();
    expect(container.firstChild).toBeInTheDocument();
  });
});
