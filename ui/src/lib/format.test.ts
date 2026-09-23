import { describe, expect, it } from "vitest";
import { formatCost, formatDuration, formatTokens } from "./format";
import { formatTimestamp } from "./time";

describe("formatTimestamp", () => {
  const now = new Date(2025, 3, 16, 15, 0); // Wednesday, Apr 16

  it("shows the clock time for today", () => {
    expect(formatTimestamp(new Date(2025, 3, 16, 10, 24).getTime(), now)).toBe("10:24 AM");
    expect(formatTimestamp(new Date(2025, 3, 16, 9, 5).getTime(), now)).toBe("09:05 AM");
  });

  it("shows Yesterday, then the weekday within a week, then the date", () => {
    expect(formatTimestamp(new Date(2025, 3, 15, 23, 59).getTime(), now)).toBe("Yesterday");
    expect(formatTimestamp(new Date(2025, 3, 14, 8, 0).getTime(), now)).toBe("Mon");
    expect(formatTimestamp(new Date(2025, 3, 9, 8, 0).getTime(), now)).toBe("Apr 9");
    expect(formatTimestamp(new Date(2024, 11, 12, 8, 0).getTime(), now)).toBe("Dec 12");
  });
});

describe("formatCost", () => {
  it("formats dollars with two decimals", () => {
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(1234.5)).toBe("$1,234.50");
  });
});

describe("formatDuration", () => {
  it("uses hours and minutes above an hour, minutes and seconds below", () => {
    expect(formatDuration((60 + 4) * 60_000)).toBe("1h 04m");
    expect(formatDuration((12 * 60 + 30) * 1000)).toBe("12m 30s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(-5)).toBe("0s");
  });
});

describe("formatTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokens(1_900_000)).toBe("1.9M");
    expect(formatTokens(412_000)).toBe("412k");
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(2_000_000)).toBe("2M");
    expect(formatTokens(999_960)).toBe("1M");
    expect(formatTokens(950)).toBe("950");
  });
});
