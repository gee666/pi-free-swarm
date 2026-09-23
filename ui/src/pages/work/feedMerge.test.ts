import { describe, expect, it } from "vitest";
import type { SessionItem } from "../../../../src/api-types";
import { appendOlder, prependNewer } from "./feedMerge";
import { entryItem } from "./testSession";

const ids = (items: SessionItem[]) => items.map((item) => item.id);

describe("feedMerge", () => {
  it("appends only unseen older items and keeps the array when nothing is new", () => {
    const items = [entryItem(3), entryItem(2)];
    expect(ids(appendOlder(items, [entryItem(2), entryItem(1)]))).toEqual(["e3:0", "e2:0", "e1:0"]);
    expect(appendOlder(items, [entryItem(2)])).toBe(items);
  });

  it("prepends unseen newer items and replaces known ones in place", () => {
    const running = { ...entryItem(2), text: "running" };
    const finished = { ...entryItem(2), text: "finished" };
    const merged = prependNewer([running, entryItem(1)], [entryItem(3), finished]);
    expect(merged.added).toBe(1);
    expect(ids(merged.items)).toEqual(["e3:0", "e2:0", "e1:0"]);
    expect(merged.items[1]).toBe(finished);
  });
});
