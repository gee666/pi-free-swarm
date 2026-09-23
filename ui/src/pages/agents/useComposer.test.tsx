import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMessage, replyToThread } from "../../api/agents";
import { swarm, thread } from "./testFixtures";
import { useComposer } from "./useComposer";

vi.mock("../../api/agents", () => ({ USER_NAME: "User", sendMessage: vi.fn(), replyToThread: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("pending message drafts", () => {
  it.each(["edit", "selection", "thread", "recipients", "unchanged"])("preserves draft after %s", async (change) => {
    let finish = () => {};
    const pending = new Promise<Awaited<ReturnType<typeof sendMessage>>>((resolve) => {
      // The hook only needs completion; no response fields are consumed.
      finish = () =>
        resolve({
          message: {
            id: 1,
            swarmId: 3,
            threadId: 1,
            sender: "User",
            senderKind: "user",
            text: "sent",
            createdAt: 0,
            recipients: [],
          },
        });
    });
    vi.mocked(sendMessage).mockReturnValue(pending);
    vi.mocked(replyToThread).mockReturnValue(pending);
    const { result, rerender } = renderHook(({ name }) => useComposer("3", swarm, [name]), {
      initialProps: { name: "John" },
    });
    act(() => result.current.setText("sent"));
    act(() => result.current.send());
    expect(result.current.busy).toBe(true);
    if (change === "edit") {
      act(() => result.current.setText("new"));
      act(() => result.current.setText("sent"));
    }
    if (change === "selection") rerender({ name: "Maria" });
    if (change === "thread") act(() => result.current.reply(thread(2, ["User", "Maria"])));
    if (change === "recipients") act(() => result.current.setTo(["Maria"]));
    await act(async () => {
      finish();
      await pending;
    });
    expect(result.current.text).toBe(change === "unchanged" ? "" : "sent");
    expect(result.current.busy).toBe(false);
  });
});
