import { describe, expect, it } from "vitest";
import {
  fileHrefFrom,
  fileReferencePath,
  hasInvalidUnicode,
  isFileReference,
  localFileHref,
  splitFilePaths,
} from "./filePaths";

const paths = (text: string) =>
  splitFilePaths(text)
    .filter((segment) => segment.kind === "path")
    .map((segment) => segment.text);

describe("file references", () => {
  it("recognizes relative, absolute, Windows, basename and line-qualified references", () => {
    expect(paths('Read src/main.ts:12:3, "README.md" and C:\\repo\\file.py.')).toEqual([
      "src/main.ts:12:3",
      "README.md",
      "C:\\repo\\file.py",
    ]);
    expect(fileReferencePath("src/main.ts:12:3")).toBe("src/main.ts");
  });
  it("preserves Unicode and spaced filenames, and quoted spaced directories", () => {
    const source = 'Read "tmp/user-replac agents.md", docs/说明.md and "C:\\My Project\\notes.md".';
    expect(paths(source)).toEqual(["tmp/user-replac agents.md", "docs/说明.md", "C:\\My Project\\notes.md"]);
    expect(
      splitFilePaths(source)
        .map((segment) => segment.text)
        .join(""),
    ).toBe(source);
    expect(paths("/repo/tmp/user-replac agents.md.")).toEqual(["/repo/tmp/user-replac agents.md"]);
    expect(isFileReference("docs/my notes.md")).toBe(true);
    expect(isFileReference("my docs/notes.md")).toBe(true);
  });
  it("does not split URLs into file links or accept executable URI schemes", () => {
    expect(paths("https://example.com/src/main.ts and src/real.ts")).toEqual(["src/real.ts"]);
    for (const reference of ["javascript:evil.ts", "data:text/plain,foo.md", "https://example.com/a.md"]) {
      expect(isFileReference(reference)).toBe(false);
    }
  });
  it("decodes local Markdown targets and resolves them from the viewed document", () => {
    expect(localFileHref("docs/my%20notes.md")).toBe("docs/my notes.md");
    expect(localFileHref(".env")).toBe(".env");
    expect(localFileHref("scripts/run")).toBe("scripts/run");
    expect(localFileHref("javascript:evil.ts")).toBeUndefined();
    expect(localFileHref("docs/%FF.md")).toBeUndefined();
    expect(localFileHref("bad\ud800.md")).toBeUndefined();
    expect(hasInvalidUnicode("bad\udfff.md")).toBe(true);
    expect(hasInvalidUnicode("docs/😀.md")).toBe(false);
    expect(fileHrefFrom("../src/main.ts", "docs/notes.md")).toBe("docs/../src/main.ts");
    expect(fileHrefFrom("/repo/src/main.ts", "docs/notes.md")).toBe("/repo/src/main.ts");
  });
});
