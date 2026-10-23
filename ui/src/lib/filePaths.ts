export interface TextSegment {
  kind: "text" | "path";
  text: string;
}

// URLs are matched first so their path part is not mistaken for a file path.
const URL_PATTERN = String.raw`(?<![\p{L}\p{N}_+.-])[a-z][a-z0-9+.-]*:\/\/\S+`;
const EXTENSIONS = String.raw`md|markdown|txt|log|jsonc?|ya?ml|toml|ini|cfg|conf|csv|tsx?|jsx?|mjs|cjs|py|sh|bash|css|scss|html?|xml|svg|sql|go|rs|java|cpp|hpp|png|jpe?g|gif|webp|avif|bmp|ico`;
const FILE = String.raw`(?:[\p{L}\p{N}_.-]*\.[A-Za-z][A-Za-z0-9]{0,9}|README|LICENSE|Dockerfile|Makefile)`;
const DIRECTORY = String.raw`[\p{L}\p{N}_@.-]+[\\/]`;
const ROOT = String.raw`(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|[\\/])`;
const QUALIFIED = `(?:${ROOT}(?:${DIRECTORY})*${FILE}|(?:${DIRECTORY})+${FILE})`;
const SPACE_DIRECTORY = String.raw`[\p{L}\p{N}_@.-][\p{L}\p{N}_@. ()-]*[\\/]`;
const SPACE_FILE = String.raw`[\p{L}\p{N}_.-][\p{L}\p{N}_. ()-]*?\.(?:${EXTENSIONS})`;
const SPACED = `(?:${ROOT})(?:${DIRECTORY})*${SPACE_FILE}`;
const LOCATION = String.raw`(?::\d+(?::\d+)?)?`;
const PATH_PATTERN = String.raw`(?<![\p{L}\p{N}_@/.~\\-])(?:${SPACED}|${QUALIFIED})${LOCATION}(?![\p{L}\p{N}_/\\-]|\.[A-Za-z0-9])`;
const FILE_REFERENCE = new RegExp(`^(?:(?:${PATH_PATTERN})|${FILE}${LOCATION})$`, "iu");
const EXPLICIT_FILE = String.raw`[\p{L}\p{N}_.-][\p{L}\p{N}_. ()-]*?\.[A-Za-z][A-Za-z0-9]{0,9}`;
const EXPLICIT_REFERENCE = new RegExp(`^(?:${ROOT})?(?:${SPACE_DIRECTORY})*${EXPLICIT_FILE}${LOCATION}$`, "iu");
const QUOTED = String.raw`(?:"[^"\r\n]+"|'[^'\r\n]+'|\x60[^\x60\r\n]+\x60)`;
const TOKEN = new RegExp(`(${URL_PATTERN})|(${QUOTED})|(${PATH_PATTERN})`, "giu");

export function hasInvalidUnicode(text: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
}

export function isFileReference(text: string): boolean {
  return FILE_REFERENCE.test(text) || EXPLICIT_REFERENCE.test(text);
}

export function localFileHref(href: string): string | undefined {
  try {
    const path = href.split(/[?#]/, 1)[0];
    if (!path) return undefined;
    const decoded = decodeURIComponent(path);
    const windows = /^[A-Za-z]:[\\/]/.test(decoded);
    if (!decoded || hasInvalidUnicode(decoded) || /[\u0000\r\n]/.test(decoded) || decoded.startsWith("//"))
      return undefined;
    if (!windows && /^[a-z][a-z0-9+.-]*:/i.test(decoded) && !isFileReference(decoded)) return undefined;
    return decoded;
  } catch (error) {
    if (error instanceof URIError) return undefined;
    throw error;
  }
}

export function fileHrefFrom(reference: string, baseFile: string | undefined): string {
  if (!baseFile || /^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/])/.test(reference)) return reference;
  const slash = Math.max(baseFile.lastIndexOf("/"), baseFile.lastIndexOf("\\"));
  return `${baseFile.slice(0, slash + 1)}${reference}`;
}

export function fileReferencePath(reference: string): string {
  return reference.replace(/:\d+(?::\d+)?$/, "");
}

/** Splits plain text into text and file-path segments. */
export function splitFilePaths(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const quoted = match[2];
    const path = quoted === undefined ? match[3] : quoted.slice(1, -1);
    if (path === undefined || (quoted !== undefined && !isFileReference(path))) continue;
    const start = match.index + (quoted === undefined ? 0 : 1);
    if (start > last) segments.push({ kind: "text", text: text.slice(last, start) });
    segments.push({ kind: "path", text: path });
    last = start + path.length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}
