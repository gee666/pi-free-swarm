// Work-tab session reader: newest-first pages of one agent's pi session file, plus live-append watching.
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { SessionItem, SessionPage } from "../api-types.js";
import { SESSION_PAGE_DEFAULT, SESSION_PAGE_MAX, SESSION_TOOL_OUTPUT_MAX_CHARS } from "../constants.js";
import { LineIndex, readLines, type LineSpan } from "./session-index.js";
import {
  collectEffects,
  emptyEffects,
  entryItems,
  isAffected,
  parseEntry,
  type EntryEffects,
  type SessionEntry,
} from "./session-parse.js";

export { SessionWatcher } from "./session-watch.js";

/** A `before`/`after` cursor that is malformed or no longer points at an entry of the file. */
export class SessionCursorError extends Error {
  constructor(
    readonly field: "before" | "after",
    message: string,
  ) {
    super(message);
    this.name = "SessionCursorError";
  }
}

interface Located {
  /** Byte offset of the entry's line; cursors carry it because it never changes in an append-only file. */
  offset: number;
  entry: SessionEntry;
}

type PageBody = Omit<SessionPage, "agent">;

const NO_EFFECTS = emptyEffects();
const CURSOR_PATTERN = /^\d{1,15}$/;
/** Entries per read when scanning around a turn boundary: tool results and retry marks are usually a handful. */
const TURN_SCAN_BATCH = 8;

function emptyPage(): PageBody {
  return { items: [], olderCursor: null, newestCursor: null };
}

function toCursor(offset: number): string {
  return String(offset);
}

function olderCursor(oldest: number): string | null {
  return oldest === 0 ? null : toCursor(oldest);
}

function parseCursor(raw: string | undefined, field: "before" | "after"): number | null {
  if (raw === undefined) return null;
  if (!CURSOR_PATTERN.test(raw)) throw new SessionCursorError(field, `Invalid ${field} cursor.`);
  return Number(raw);
}

function clampLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.min(SESSION_PAGE_MAX, Math.max(1, Math.floor(limit))) : SESSION_PAGE_DEFAULT;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

/** One open session file with its index, valid for a single serialized read. */
class OpenSession {
  constructor(
    private readonly file: FileHandle,
    private readonly index: LineIndex,
  ) {}

  get end(): number {
    return this.index.end;
  }

  newest(): Promise<number | null> {
    return this.index.newest(this.file);
  }

  isEntry(offset: number): Promise<boolean> {
    return this.index.isLineStart(this.file, offset);
  }

  async before(bound: number, count: number): Promise<Located[]> {
    return this.load(await this.index.before(this.file, bound, count));
  }

  after(offset: number, count: number): Promise<Located[]> {
    return this.load(this.index.after(offset, count));
  }

  /**
   * Entries after `offset` up to the next assistant turn. pi persists every tool result and retry mark of a
   * turn before the next model call, so this is all an assistant entry at or before `offset` still waits for.
   */
  async turnTail(offset: number): Promise<SessionEntry[]> {
    const tail: SessionEntry[] = [];
    for (let from = offset; ;) {
      const entries = await this.after(from, TURN_SCAN_BATCH);
      if (entries.length === 0) return tail;
      for (const { entry } of entries) {
        if (entry.kind === "assistant") return tail;
        tail.push(entry);
      }
      from = entries[entries.length - 1].offset;
    }
  }

  /** The newest assistant entry before `bound` followed by the entries after it, or [] when a prompt comes first. */
  async openTurn(bound: number): Promise<Located[]> {
    const between: Located[] = [];
    for (let from = bound; ;) {
      const entries = await this.before(from, TURN_SCAN_BATCH);
      if (entries.length === 0) return [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const located = entries[i];
        if (located.entry.kind === "assistant") return [located, ...between];
        if (located.entry.kind === "user") return [];
        between.unshift(located);
      }
      from = entries[0].offset;
    }
  }

  private async load(spans: LineSpan[]): Promise<Located[]> {
    const lines = await readLines(this.file, spans);
    return spans.map((span, i) => ({ offset: span.start, entry: parseEntry(lines[i]) }));
  }
}

export class SessionReader {
  private readonly maxToolOutputChars: number;
  private readonly files = new Map<string, { index: LineIndex; queue: Promise<unknown> }>();

  constructor(options: { maxToolOutputChars?: number } = {}) {
    this.maxToolOutputChars = options.maxToolOutputChars ?? SESSION_TOOL_OUTPUT_MAX_CHARS;
  }

  /**
   * `after` pages hold the entries just after the cursor (oldest `limit` of them; fetch again while full) and
   * repeat the still-open assistant entry when its tool results or retry mark arrived: clients upsert by item id.
   */
  async readPage(
    agent: string,
    sessionFile: string,
    query: { before?: string; after?: string; limit: number },
  ): Promise<SessionPage> {
    const before = parseCursor(query.before, "before");
    const after = parseCursor(query.after, "after");
    if (before !== null && after !== null) {
      throw new SessionCursorError("after", "Use either before or after, not both.");
    }
    const limit = clampLimit(query.limit);
    const body = await this.withSession(sessionFile, async (session) => {
      const cursor = after ?? before;
      if (cursor !== null && !(await session.isEntry(cursor))) {
        throw new SessionCursorError(after !== null ? "after" : "before", "The cursor does not match this session.");
      }
      return after !== null ? this.newerPage(session, after, limit) : this.olderPage(session, before, limit);
    });
    return { agent, ...(body ?? emptyPage()) };
  }

  /** Cursor of the newest complete entry, or null while the file is missing or empty. */
  async newestCursor(sessionFile: string): Promise<string | null> {
    const newest = await this.withSession(sessionFile, (session) => session.newest());
    return newest === null ? null : toCursor(newest);
  }

  private async olderPage(session: OpenSession, bound: number | null, limit: number): Promise<PageBody> {
    const visible = ({ entry }: Located) => entryItems(entry, NO_EFFECTS, this.maxToolOutputChars).length > 0;
    let entries: Located[] = [];
    let from = bound ?? session.end;
    // Keep going past entries that show nothing (header, system prompt) so a page is empty only at the start.
    do {
      const batch = await session.before(from, limit);
      if (batch.length === 0) break;
      entries = batch.concat(entries);
      from = batch[0].offset;
    } while (from > 0 && !entries.some(visible));
    if (entries.length === 0) {
      return bound === null ? emptyPage() : { items: [], olderCursor: null, newestCursor: toCursor(bound) };
    }
    const newest = entries[entries.length - 1].offset;
    const effects = collectEffects([...entries.map((l) => l.entry), ...(await session.turnTail(newest))]);
    return {
      items: this.items(entries, effects),
      olderCursor: olderCursor(entries[0].offset),
      newestCursor: toCursor(newest),
    };
  }

  private async newerPage(session: OpenSession, cursor: number, limit: number): Promise<PageBody> {
    const fresh = await session.after(cursor, limit);
    if (fresh.length === 0) return { items: [], olderCursor: olderCursor(cursor), newestCursor: toCursor(cursor) };
    const newest = fresh[fresh.length - 1].offset;
    const effects = collectEffects([...fresh.map((l) => l.entry), ...(await session.turnTail(newest))]);
    const [turnStart, ...seen] = await session.openTurn(fresh[0].offset);
    const repeat = turnStart !== undefined && isAffected(turnStart.entry, effects);
    // The repeated entry also needs the results the client already had before the cursor.
    if (repeat)
      collectEffects(
        seen.map((l) => l.entry),
        effects,
      );
    const shown = repeat ? [turnStart, ...fresh] : fresh;
    return {
      items: this.items(shown, effects),
      olderCursor: olderCursor(shown[0].offset),
      newestCursor: toCursor(newest),
    };
  }

  /** Items of `entries` (oldest first) as the API wants them: newest first. */
  private items(entries: readonly Located[], effects: EntryEffects): SessionItem[] {
    return entries.flatMap(({ entry }) => entryItems(entry, effects, this.maxToolOutputChars)).reverse();
  }

  /** Runs `read` with the file open and indexed; reads of one file are serialized. Null when the file is missing. */
  private withSession<T>(sessionFile: string, read: (session: OpenSession) => Promise<T>): Promise<T | null> {
    const key = path.resolve(sessionFile);
    let state = this.files.get(key);
    if (!state) {
      state = { index: new LineIndex(), queue: Promise.resolve() };
      this.files.set(key, state);
    }
    const { index } = state;
    const run = state.queue.then(async () => {
      let file: FileHandle;
      try {
        file = await open(key, "r");
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
      try {
        await index.sync(file);
        return await read(new OpenSession(file, index));
      } finally {
        await file.close();
      }
    });
    // The caller gets the failure through `run`; the queue only needs to know the read is over.
    state.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
