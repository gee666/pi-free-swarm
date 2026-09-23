// Server-host election: of all main pi processes in a folder, the one holding the server_host row serves the
// board. The others poll and take over when its heartbeat goes stale or its pid dies, keeping the port.
import { sweepStaleRuns } from "../broker/swarms.js";
import { systemClock, type Clock, type TimerHandle } from "../clock.js";
import {
  EVENTS_PRUNE_INTERVAL_MS,
  EVENTS_RETENTION_MS,
  PORT_ENV,
  SERVER_BIND_HOST,
  SERVER_HOST_HEARTBEAT_MS,
  SERVER_HOST_POLL_MS,
  SETTINGS_FILE,
  STALE_SWEEP_INTERVAL_MS,
  SWARM_DIR,
} from "../constants.js";
import { loadSettings, resolvePort } from "../settings.js";
import type { SwarmDb } from "../store/db.js";
import { pruneEvents } from "../store/events.js";
import {
  claimServerHost,
  heartbeatServerHost,
  isPidAlive,
  readServerHost,
  releaseServerHost,
  setServerHostPort,
  type PidAlive,
} from "../store/locks.js";
import { createApiRoutes } from "./api.js";
import { PortsInUseError, startBoardServer, type BoardServer } from "./http.js";
import { SessionReader, SessionWatcher } from "./sessions.js";
import { SseHub } from "./sse.js";

export interface HostIntervals {
  pollMs: number;
  heartbeatMs: number;
  sweepMs: number;
  pruneMs: number;
}

const DEFAULT_HOST_INTERVALS: Readonly<HostIntervals> = {
  pollMs: SERVER_HOST_POLL_MS,
  heartbeatMs: SERVER_HOST_HEARTBEAT_MS,
  sweepMs: STALE_SWEEP_INTERVAL_MS,
  pruneMs: EVENTS_PRUNE_INTERVAL_MS,
};

export interface PortChoice {
  candidates: number[];
  /** Configured by the user: no fallback to other ports. */
  explicit: boolean;
}

export interface ServerHostOptions {
  cwd: string;
  getDb(): SwarmDb | null;
  /** The built board (`ui_dist/` of this package). */
  uiDir: string;
  pid?: number;
  clock?: Clock;
  alive?: PidAlive;
  intervals?: Partial<HostIntervals>;
  /** Defaults to settings.json `port`, then PI_SWARM_PORT, then the 3010–3030 range. */
  ports?(): PortChoice;
  onError?(message: string): void;
}

interface Bound {
  server: BoardServer;
  hub: SseHub;
}

interface Hosting extends Bound {
  db: SwarmDb;
  timers: TimerHandle[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ServerHost {
  private readonly options: ServerHostOptions;
  private readonly pid: number;
  private readonly clock: Clock;
  private readonly alive: PidAlive;
  private readonly intervals: HostIntervals;
  private readonly reader = new SessionReader();
  private readonly watcher: SessionWatcher;
  private pollTimer: TimerHandle | null = null;
  private hosting: Hosting | null = null;
  private electing: Promise<void> | null = null;
  /** Bumped by stop(), so an election that was binding when stop() ran gives its server up. */
  private generation = 0;
  private lastError: string | null = null;

  constructor(options: ServerHostOptions) {
    this.options = options;
    this.pid = options.pid ?? process.pid;
    this.clock = options.clock ?? systemClock;
    this.alive = options.alive ?? isPidAlive;
    this.intervals = { ...DEFAULT_HOST_INTERVALS, ...options.intervals };
    this.watcher = new SessionWatcher({ reader: this.reader, clock: this.clock });
  }

  /** Elects now and then every poll interval; each election is a no-op while there is no DB yet. */
  start(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = this.clock.every(this.intervals.pollMs, () => void this.elect());
    void this.elect();
  }

  /** Runs one election now and returns the board URL of whoever hosts. */
  async ensure(): Promise<string | null> {
    await this.elect();
    return this.boardUrl();
  }

  boardUrl(): string | null {
    const db = this.options.getDb();
    const host = db === null ? null : readServerHost(db, this.clock.now(), this.alive);
    return host === null ? null : `http://${SERVER_BIND_HOST}:${host.port}`;
  }

  async stop(): Promise<void> {
    this.generation++;
    this.pollTimer?.cancel();
    this.pollTimer = null;
    await this.electing;
    const db = this.hosting?.db;
    await this.stopHosting();
    if (db !== undefined) releaseServerHost(db, this.pid);
  }

  /** For process "exit", where nothing async runs: hands the row (and its port) to the next process. */
  releaseSync(): void {
    if (this.hosting !== null) releaseServerHost(this.hosting.db, this.pid);
  }

  private elect(): Promise<void> {
    this.electing ??= this.runElection().finally(() => (this.electing = null));
    return this.electing;
  }

  private async runElection(): Promise<void> {
    const db = this.options.getDb();
    if (db === null || this.hosting !== null) return;
    const generation = this.generation;
    try {
      const claim = claimServerHost(db, this.pid, this.clock.now(), this.alive);
      if (!claim.claimed) return;
      const bound = await this.bind(db, claim.previousPort);
      if (bound === null) {
        releaseServerHost(db, this.pid);
        return;
      }
      try {
        // Binding awaited: stop() may have run, or another process may have taken the row meanwhile.
        if (generation !== this.generation || !heartbeatServerHost(db, this.pid, this.clock.now())) {
          await bound.server.close();
          return;
        }
        setServerHostPort(db, this.pid, bound.server.port);
      } catch (error) {
        await bound.server.close();
        throw error;
      }
      this.lastError = null;
      this.beginHosting(db, bound);
    } catch (error) {
      // Runs from a timer: a failure (e.g. the DB stayed locked) must not crash pi; the next poll retries.
      this.report(`Board host election failed: ${describeError(error)}`);
    }
  }

  /** `null` after reporting why no port could be bound. */
  private async bind(db: SwarmDb, previousPort: number | null): Promise<Bound | null> {
    let choice: PortChoice;
    try {
      choice = this.options.ports?.() ?? resolvePort(loadSettings(this.options.cwd).settings);
    } catch (error) {
      this.report(describeError(error));
      return null;
    }
    // The previous host's port first keeps the board URL stable across takeovers.
    const candidates =
      choice.explicit || previousPort === null
        ? choice.candidates
        : [previousPort, ...choice.candidates.filter((port) => port !== previousPort)];
    const hub = new SseHub({ db, clock: this.clock, watcher: this.watcher });
    const api = createApiRoutes({ db, clock: this.clock, sessions: this.reader, alive: this.alive });
    try {
      const server = await startBoardServer({ candidates, uiDir: this.options.uiDir, routes: [hub.route, api] });
      return { server, hub };
    } catch (error) {
      this.report(this.bindError(error, choice));
      return null;
    }
  }

  private bindError(error: unknown, choice: PortChoice): string {
    if (!(error instanceof PortsInUseError)) return `Board server failed to start: ${describeError(error)}`;
    if (choice.explicit) {
      return `Board port ${choice.candidates[0]} is in use (configured in ${SWARM_DIR}/${SETTINGS_FILE} or ${PORT_ENV}).`;
    }
    return `No free board port: ${error.ports.join(", ")} are all in use.`;
  }

  private beginHosting(db: SwarmDb, { server, hub }: Bound): void {
    hub.start();
    const sweep = () => sweepStaleRuns(db, this.clock.now(), this.alive);
    const prune = () => pruneEvents(db, this.clock.now() - EVENTS_RETENTION_MS);
    const heartbeat = () => {
      if (!heartbeatServerHost(db, this.pid, this.clock.now())) void this.stopHosting();
    };
    this.hosting = {
      db,
      server,
      hub,
      timers: [
        this.clock.every(this.intervals.heartbeatMs, () => this.guard(heartbeat)),
        this.clock.every(this.intervals.sweepMs, () => this.guard(sweep)),
        this.clock.every(this.intervals.pruneMs, () => this.guard(prune)),
      ],
    };
    this.guard(sweep);
    this.guard(prune);
  }

  private async stopHosting(): Promise<void> {
    const hosting = this.hosting;
    if (hosting === null) return;
    this.hosting = null;
    for (const timer of hosting.timers) timer.cancel();
    hosting.hub.stop();
    await hosting.server.close();
  }

  /** Timer bodies must not throw into pi's event loop; a transient DB error is retried by the next tick. */
  private guard(task: () => unknown): void {
    try {
      task();
    } catch (error) {
      this.report(`Board host: ${describeError(error)}`);
    }
  }

  /** Repeats of the same problem on every poll are reported once. */
  private report(message: string): void {
    if (message === this.lastError) return;
    this.lastError = message;
    (this.options.onError ?? ((text: string) => console.error(`[pi-free-swarm] ${text}`)))(message);
  }
}
