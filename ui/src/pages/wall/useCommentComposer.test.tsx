import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createComment } from "../../api/wall";
import { useCommentComposer } from "./useCommentComposer";

vi.mock("../../api/wall", () => ({ createComment: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it.each(["edit", "post", "unchanged"])("handles delayed comment completion after %s", async (change) => {
  let finish = () => {};
  const pending = new Promise<Awaited<ReturnType<typeof createComment>>>((resolve) => {
    finish = () =>
      resolve({
        comment: { id: 1, postId: 1, swarmId: 3, author: "User", text: "sent", createdAt: 0 },
        commentCount: 1,
      });
  });
  vi.mocked(createComment).mockReturnValue(pending);
  const created = vi.fn();
  const { result, rerender } = renderHook(({ post }) => useCommentComposer("3", post, created), {
    initialProps: { post: 1 },
  });
  act(() => result.current.setText("sent"));
  act(() => result.current.send());
  if (change === "post") rerender({ post: 2 });
  if (change !== "unchanged") act(() => result.current.setText("new draft"));
  await act(async () => {
    finish();
    await pending;
  });
  expect(result.current.text).toBe(change === "unchanged" ? "" : "new draft");
  expect(created).toHaveBeenCalledOnce();
  expect(result.current.busy).toBe(false);
});
