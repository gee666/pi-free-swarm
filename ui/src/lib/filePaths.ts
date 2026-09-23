export interface TextSegment {
  kind: "text" | "path";
  text: string;
}

// URLs are matched first so their path part is not mistaken for a file path.
const URL_PATTERN = String.raw`[a-z][a-z0-9+.-]*:\/\/\S+`;
// At least one directory, a name with a letter-led extension, and an optional :line[:col].
const PATH_PATTERN = String.raw`(?<![\w@/.~-])(?:\.{1,2}\/|~\/|\/)?(?:[\w@.-]+\/)+[\w.-]*\.[A-Za-z][A-Za-z0-9]{0,9}(?::\d+(?::\d+)?)?(?![\w/-])`;
const TOKEN = new RegExp(`(${URL_PATTERN})|(${PATH_PATTERN})`, "gi");

/** Splits plain text into text and file-path segments. */
export function splitFilePaths(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const path = match[2];
    if (path === undefined) continue;
    if (match.index > last) segments.push({ kind: "text", text: text.slice(last, match.index) });
    segments.push({ kind: "path", text: path });
    last = match.index + path.length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}
