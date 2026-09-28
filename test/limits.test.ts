import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BODY_SAFETY_MAX,
  bodyCeiling,
  charCount,
  checkText,
  checkTitle,
  clipWithSuffix,
  MAIN_FEEDBACK_MAX,
  TEXT_MAX,
} from "../src/limits.js";

describe("limits", () => {
  it("trims and accepts text up to the limit", () => {
    assert.deepEqual(checkText("  hi  "), { ok: true, value: "hi" });
    assert.deepEqual(checkText("x".repeat(TEXT_MAX)), { ok: true, value: "x".repeat(TEXT_MAX) });
  });

  it("uses the exact error texts", () => {
    assert.deepEqual(checkText("   "), { ok: false, error: "Text is empty." });
    assert.deepEqual(checkText("x".repeat(201)), {
      ok: false,
      error: "Too long: 201/200 characters. Shorten it or point to a file path.",
    });
    assert.deepEqual(checkTitle(""), { ok: false, error: "Title is empty." });
    assert.deepEqual(checkTitle("t".repeat(72)), { ok: false, error: "Title too long: 72/60 characters. Shorten it." });
  });

  it("counts code points like SQLite length()", () => {
    assert.equal(charCount("😀😀"), 2);
    assert.equal(checkText("😀".repeat(TEXT_MAX)).ok, true);
    assert.equal(checkText("😀".repeat(TEXT_MAX + 1)).ok, false);
    assert.equal(checkTitle("é".repeat(60)).ok, true);
  });

  it("tolerates twice the stated body limit, within the storage bound", () => {
    assert.equal(bodyCeiling(TEXT_MAX), 400);
    assert.equal(bodyCeiling(BODY_SAFETY_MAX), BODY_SAFETY_MAX);
  });

  it("clips text so head and suffix fit exactly", () => {
    assert.equal(clipWithSuffix("short", "[more]", 50), "short [more]");
    const clipped = clipWithSuffix("😀".repeat(100), "[more]", 20);
    assert.equal(clipped, `${"😀".repeat(13)} [more]`);
    assert.equal(charCount(clipped), 20);
  });

  it("gives Main feedback its own larger limit", () => {
    assert.equal(checkText("x".repeat(MAIN_FEEDBACK_MAX), MAIN_FEEDBACK_MAX).ok, true);
    assert.equal(checkText("x".repeat(MAIN_FEEDBACK_MAX + 1), MAIN_FEEDBACK_MAX).ok, false);
  });
});
