import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAnchoredPosition } from "./useAnchoredPosition";

function anchorAt(x: number, y: number, width: number, height: number) {
  const element = document.createElement("button");
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
  });
  return { current: element };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps a right-edge dropdown within the mobile viewport and caps matched width", () => {
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 800);
  const anchor = anchorAt(0, 50, 500, 40);
  const { result } = renderHook(() => useAnchoredPosition(anchor, true, "end", true));
  expect(result.current).toMatchObject({
    position: "fixed",
    right: 16,
    top: 98,
    minWidth: 358,
    maxWidth: 358,
  });
});

it.each([0, 350])("keeps edge-centered content readable for an anchor at x=%s", (x) => {
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 800);
  const anchor = anchorAt(x, 50, 40, 40);
  const { result } = renderHook(() => useAnchoredPosition(anchor, true, "center"));
  expect(result.current).toMatchObject({ left: 195, transform: "translateX(-50%)", maxWidth: 358 });
});

it("retains anchor-centered placement away from viewport edges", () => {
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 800);
  const anchor = anchorAt(130, 50, 40, 40);
  const { result } = renderHook(() => useAnchoredPosition(anchor, true, "center"));
  expect(result.current).toMatchObject({ left: 150, transform: "translateX(-50%)", maxWidth: 268 });
});

it("recomputes available width on resize and clears positioning when closed", () => {
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 800);
  const anchor = anchorAt(20, 700, 40, 40);
  const { result, rerender } = renderHook(({ open }) => useAnchoredPosition(anchor, open, "start"), {
    initialProps: { open: true },
  });
  expect(result.current).toMatchObject({ left: 20, bottom: 108, maxHeight: 676, maxWidth: 354 });
  act(() => {
    vi.stubGlobal("innerWidth", 200);
    window.dispatchEvent(new Event("resize"));
  });
  expect(result.current).toMatchObject({ left: 20, maxWidth: 164 });
  rerender({ open: false });
  expect(result.current).toBeUndefined();
});
