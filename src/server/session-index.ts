// Byte offsets of the complete lines at the tail of an append-only JSONL file. It starts at the end of the
// file and grows backwards only as far as paging needs, so a large session never has to be read whole.
import type { FileHandle } from "node:fs/promises";

const CHUNK_BYTES = 64 * 1024;
const NEWLINE = 0x0a;

/** One line: `start` is the offset of its first byte, `end` the offset of its terminating newline. */
export interface LineSpan {
  start: number;
  end: number;
}

async function readBytes(file: FileHandle, start: number, end: number): Promise<Buffer> {
  const buffer = Buffer.alloc(end - start);
  let filled = 0;
  while (filled < buffer.length) {
    const { bytesRead } = await file.read(buffer, filled, buffer.length - filled, start + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return filled === buffer.length ? buffer : buffer.subarray(0, filled);
}

/** Offset just after the last newline before `size`, i.e. the end of the last complete line (0 if none). */
async function completeEnd(file: FileHandle, size: number): Promise<number> {
  for (let end = size; end > 0; end -= CHUNK_BYTES) {
    const start = Math.max(0, end - CHUNK_BYTES);
    const at = (await readBytes(file, start, end)).lastIndexOf(NEWLINE);
    if (at >= 0) return start + at + 1;
  }
  return 0;
}

/** Index of the first element of the ascending `values` that is `>= target`. */
function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

export class LineIndex {
  /** Ascending starts of the complete lines in `[coveredFrom, indexedEnd)`. */
  private starts: number[] = [];
  private coveredFrom = 0;
  private indexedEnd = 0;
  private inode: number | null = null;

  /** Catches up with appended bytes; a replaced or shrunk file starts a fresh index. A partial last line is left out. */
  async sync(file: FileHandle): Promise<void> {
    const { ino, size } = await file.stat();
    if (ino !== this.inode || size < this.indexedEnd) {
      this.inode = ino;
      this.starts = [];
      this.coveredFrom = this.indexedEnd = await completeEnd(file, size);
      return;
    }
    let lineStart = this.indexedEnd;
    for (let position = this.indexedEnd; position < size; position += CHUNK_BYTES) {
      const chunk = await readBytes(file, position, Math.min(size, position + CHUNK_BYTES));
      for (let at = chunk.indexOf(NEWLINE); at >= 0; at = chunk.indexOf(NEWLINE, at + 1)) {
        this.starts.push(lineStart);
        lineStart = position + at + 1;
      }
    }
    this.indexedEnd = lineStart;
  }

  /** End of the last complete line: the bound for the newest page. */
  get end(): number {
    return this.indexedEnd;
  }

  /** Start of the newest complete line, or null when the file has none. */
  async newest(file: FileHandle): Promise<number | null> {
    const [last] = await this.before(file, this.indexedEnd, 1);
    return last ? last.start : null;
  }

  /** True when `offset` is the start of a complete line. */
  async isLineStart(file: FileHandle, offset: number): Promise<boolean> {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= this.indexedEnd) return false;
    while (this.coveredFrom > offset) await this.extendBackward(file);
    return this.starts[lowerBound(this.starts, offset)] === offset;
  }

  /** Up to `count` lines starting before `bound` (a line start or the indexed end), oldest first. */
  async before(file: FileHandle, bound: number, count: number): Promise<LineSpan[]> {
    let end = lowerBound(this.starts, bound);
    while (end < count && this.coveredFrom > 0) end += await this.extendBackward(file);
    return this.spans(Math.max(0, end - count), end);
  }

  /** Up to `count` lines after the line starting at `offset`, oldest first. `offset` must be a line start. */
  after(offset: number, count: number): LineSpan[] {
    const from = lowerBound(this.starts, offset) + 1;
    return this.spans(from, Math.min(this.starts.length, from + count));
  }

  private spans(from: number, to: number): LineSpan[] {
    const spans: LineSpan[] = [];
    for (let i = from; i < to; i++) {
      spans.push({
        start: this.starts[i],
        end: (i + 1 < this.starts.length ? this.starts[i + 1] : this.indexedEnd) - 1,
      });
    }
    return spans;
  }

  /** Adds the line(s) just before `coveredFrom`; returns how many starts were added. */
  private async extendBackward(file: FileHandle): Promise<number> {
    const found: number[] = [];
    // The byte before `coveredFrom` ends the previous line, so search before it for that line's start.
    let scanEnd = this.coveredFrom - 1;
    while (found.length === 0) {
      const scanStart = Math.max(0, scanEnd - CHUNK_BYTES);
      const chunk = await readBytes(file, scanStart, scanEnd);
      for (let at = chunk.lastIndexOf(NEWLINE); at >= 0; at = at > 0 ? chunk.lastIndexOf(NEWLINE, at - 1) : -1) {
        found.push(scanStart + at + 1);
      }
      if (scanStart === 0) found.push(0);
      scanEnd = scanStart;
    }
    this.starts = found.reverse().concat(this.starts);
    this.coveredFrom = this.starts[0];
    return found.length;
  }
}

/** Reads the text of consecutive `spans` with one read. */
export async function readLines(file: FileHandle, spans: readonly LineSpan[]): Promise<string[]> {
  if (spans.length === 0) return [];
  const base = spans[0].start;
  const bytes = await readBytes(file, base, spans[spans.length - 1].end);
  return spans.map((span) => bytes.toString("utf8", span.start - base, span.end - base));
}
