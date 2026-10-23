import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createComment } from "../../api/wall";
import { useCommentComposer } from "./useCommentComposer";
import { ComposerDraftsProvider } from "../../components/compose/ComposerDrafts";

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
    wrapper: ComposerDraftsProvider,
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

it("clears the submitted post's unchanged draft after navigation without erasing another post", async () => {
  let finish = () => {};
  const pending = new Promise<Awaited<ReturnType<typeof createComment>>>((resolve) => {
    finish = () =>
      resolve({
        comment: { id: 1, postId: 1, swarmId: 3, author: "User", text: "sent", createdAt: 0 },
        commentCount: 1,
      });
  });
  vi.mocked(createComment).mockReturnValue(pending);
  const { result, rerender } = renderHook(({ post }) => useCommentComposer("3", post, vi.fn()), {
    initialProps: { post: 1 },
    wrapper: ComposerDraftsProvider,
  });
  act(() => result.current.setText("sent"));
  act(() => result.current.send());
  rerender({ post: 2 });
  act(() => result.current.setText("second draft"));
  await act(async () => {
    finish();
    await pending;
  });
  expect(result.current.text).toBe("second draft");
  rerender({ post: 1 });
  expect(result.current.text).toBe("");
});

it("retains a failed submission when returning to its post", async () => {
  vi.mocked(createComment).mockRejectedValue(new Error("offline"));
  const { result, rerender } = renderHook(({ post }) => useCommentComposer("3", post, vi.fn()), {
    initialProps: { post: 1 },
    wrapper: ComposerDraftsProvider,
  });
  act(() => result.current.setText("keep me"));
  await act(async () => result.current.send());
  expect(result.current.error).toBe("offline");
  rerender({ post: 2 });
  expect(result.current.text).toBe("");
  rerender({ post: 1 });
  expect(result.current.text).toBe("keep me");
});
