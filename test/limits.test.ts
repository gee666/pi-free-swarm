import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { charCount, checkText, checkTitle, MAIN_FEEDBACK_MAX } from "../src/limits.js";

describe("limits", () => {
  it("trims and accepts text up to the limit", () => {
    assert.deepEqual(checkText("  hi  "), { ok: true, value: "hi" });
    assert.deepEqual(checkText("x".repeat(200)), { ok: true, value: "x".repeat(200) });
  });

  it("uses the exact error texts", () => {
    assert.deepEqual(checkText("   "), { ok: false, error: "Text is empty." });
    assert.deepEqual(checkText("x".repeat(243)), {
      ok: false,
      error: "Too long: 243/200 characters. Shorten it or point to a file path.",
    });
    assert.deepEqual(checkTitle(""), { ok: false, error: "Title is empty." });
    assert.deepEqual(checkTitle("t".repeat(72)), { ok: false, error: "Title too long: 72/60 characters. Shorten it." });
  });

  it("counts code points like SQLite length()", () => {
    assert.equal(charCount("😀😀"), 2);
    assert.equal(checkText("😀".repeat(200)).ok, true);
    assert.equal(checkText("😀".repeat(201)).ok, false);
    assert.equal(checkTitle("é".repeat(60)).ok, true);
  });

  it("allows a larger max for Main feedback", () => {
    assert.equal(checkText("x".repeat(MAIN_FEEDBACK_MAX), MAIN_FEEDBACK_MAX).ok, true);
    assert.equal(checkText("x".repeat(MAIN_FEEDBACK_MAX + 1), MAIN_FEEDBACK_MAX).ok, false);
  });
});
