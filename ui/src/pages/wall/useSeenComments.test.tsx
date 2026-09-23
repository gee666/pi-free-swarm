import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PostSummary } from "../../../../src/api-types";
import { useSeenComments } from "./useSeenComments";

afterEach(() => vi.unstubAllGlobals());
const post: PostSummary = {
  id: 1,
  swarmId: 3,
  author: "John",
  title: "Plan",
  text: "Plan",
  commentCount: 2,
  createdAt: 0,
};

it.each(["malformed", "blocked", "quota"])("keeps unread tracking in memory with %s storage", (failure) => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      if (failure === "blocked") throw new DOMException("Blocked", "SecurityError");
      return failure === "malformed" ? "{broken" : null;
    },
    setItem: () => {
      if (failure !== "malformed") throw new DOMException("Full", "QuotaExceededError");
    },
  });
  const initialProps: { count: number; open: number | undefined } = { count: 2, open: undefined };
  const { result, rerender } = renderHook(
    ({ count, open }: { count: number; open: number | undefined }) =>
      useSeenComments("3", [{ ...post, commentCount: count }], open),
    { initialProps },
  );
  rerender({ count: 3, open: undefined });
  expect(result.current({ ...post, commentCount: 3 })).toBe(1);
  rerender({ count: 3, open: 1 });
  expect(result.current({ ...post, commentCount: 3 })).toBe(0);
});
