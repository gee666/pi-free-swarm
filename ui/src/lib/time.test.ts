import { describe, expect, it } from "vitest";
import { relativeTime, shortDuration } from "./time";

describe("compact work times", () => {
  it("formats minutes and hours without counting partial minutes", () => {
    expect(shortDuration(90000)).toBe("1 min");
    expect(shortDuration(80 * 60000)).toBe("1 h 20 min");
    expect(shortDuration(-1)).toBe("0 min");
  });
  it("measures work timestamps against the supplied clock", () => {
    expect(relativeTime(120000, 300000)).toBe("3 min");
    expect(relativeTime(300000, 120000)).toBe("just now");
    expect(relativeTime(241000, 300000)).toBe("just now");
    expect(relativeTime(240000, 300000)).toBe("1 min");
  });
});
