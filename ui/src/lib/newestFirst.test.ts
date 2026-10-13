import { describe, expect, it } from "vitest";
import { insertNewest, newestFirst } from "./newestFirst";

describe("newestFirst", () => {
  const oldest = { id: 1, createdAt: 10 };
  const sameTime = { id: 2, createdAt: 10 };
  const newest = { id: 3, createdAt: 20 };

  it("sorts by timestamp and then descending id without changing its input", () => {
    const input = [oldest, newest, sameTime];
    expect(newestFirst(input)).toEqual([newest, sameTime, oldest]);
    expect(input).toEqual([oldest, newest, sameTime]);
  });

  it("inserts delayed records in chronological order and skips duplicates", () => {
    const input = [newest, oldest];
    expect(insertNewest(input, sameTime)).toEqual([newest, sameTime, oldest]);
    expect(insertNewest(input, newest)).toBe(input);
  });
});
