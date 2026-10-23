import { expect, it } from "vitest";
import { codeLanguage, fileLanguage } from "./codeLanguages";

it("selects only registered explicit language aliases", () => {
  expect(codeLanguage("TSX")).toBe("typescript");
  expect(fileLanguage("src/code.py")).toBe("python");
  for (const language of [undefined, "unknown", "constructor", "__proto__", "toString"]) {
    expect(codeLanguage(language)).toBeUndefined();
  }
});
