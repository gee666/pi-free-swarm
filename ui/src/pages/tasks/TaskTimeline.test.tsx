import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TimelineBody } from "./TimelineBody";

afterEach(() => vi.restoreAllMocks());

it("expands body text only when its two-line preview overflows", async () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(60);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(40);
  render(<TimelineBody text="Review evidence for this task" />);
  const more = screen.getByRole("button", { name: "more" });
  expect(more).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(more);
  expect(screen.getByRole("button", { name: "less" })).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(screen.getByRole("button", { name: "less" }));
  expect(screen.getByRole("button", { name: "more" })).toHaveAttribute("aria-expanded", "false");
});

it("does not offer expansion for a short body", () => {
  render(<TimelineBody text="Done" />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
