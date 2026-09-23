// Notices new complete entries in session files. fs.watch on the parent directory gives fast notice (the file
// may not exist yet); size polling covers platforms and moments where fs.watch is silent or impossible.
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { systemClock, type Clock, type TimerHandle } from "../clock.js";
import { SESSION_WATCH_POLL_MS } from "../constants.js";
import type { SessionReader } from "./sessions.js";

class FileWatch {
  private readonly dir: string;
  private readonly base: string;
  private directoryWatcher: FSWatcher | null = null;
  private readonly poll: TimerHandle;
  /** Newest cursor already reported; undefined until the first check has run. */
  private lastCursor: string | null | undefined = undefined;
  private checking = false;
  private recheck = false;
  private stopped = false;

  constructor(
    private readonly reader: SessionReader,
    private readonly sessionFile: string,
    private readonly onAppended: (newestCursor: string) => void,
    clock: Clock,
  ) {
    this.dir = path.dirname(sessionFile);
    this.base = path.basename(sessionFile);
    this.watchDirectory();
    this.poll = clock.every(SESSION_WATCH_POLL_MS, () => {
      this.watchDirectory();
      void this.check();
    });
    void this.check();
  }

  stop(): void {
    this.stopped = true;
    this.poll.cancel();
    this.closeDirectoryWatcher();
  }

  private watchDirectory(): void {
    if (this.directoryWatcher || this.stopped) return;
    try {
      this.directoryWatcher = watch(this.dir, (_event, name) => {
        if (name === null || name === this.base) void this.check();
      });
    } catch {
      // The agent's directory does not exist yet; the next poll tries again.
      return;
    }
    this.directoryWatcher.on("error", () => this.closeDirectoryWatcher());
  }

  private closeDirectoryWatcher(): void {
    this.directoryWatcher?.close();
    this.directoryWatcher = null;
  }

  /** Reports the newest cursor when it moved; overlapping triggers collapse into one extra pass. */
  private async check(): Promise<void> {
    if (this.checking) {
      this.recheck = true;
      return;
    }
    this.checking = true;
    try {
      do {
        this.recheck = false;
        // A failed read (file being replaced, permissions) is retried by the next poll.
        const cursor = await this.reader.newestCursor(this.sessionFile).catch(() => undefined);
        if (this.stopped || cursor === undefined) return;
        const known = this.lastCursor;
        this.lastCursor = cursor;
        if (known !== undefined && cursor !== null && cursor !== known) this.onAppended(cursor);
      } while (this.recheck);
    } finally {
      this.checking = false;
    }
  }
}

export class SessionWatcher {
  private readonly reader: SessionReader;
  private readonly clock: Clock;

  constructor(options: { reader: SessionReader; clock?: Clock }) {
    this.reader = options.reader;
    this.clock = options.clock ?? systemClock;
  }

  /** Calls `onAppended` with the new newest cursor whenever complete entries are appended; returns the unwatch function. */
  watch(_agent: string, sessionFile: string, onAppended: (newestCursor: string) => void): () => void {
    const fileWatch = new FileWatch(this.reader, sessionFile, onAppended, this.clock);
    return () => fileWatch.stop();
  }
}
