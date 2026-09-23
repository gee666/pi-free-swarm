// Live board updates: tails the events outbox (written by any process) and pushes each row to the SSE clients
// watching its swarm; session.appended comes straight from the session watcher and is never stored.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SwarmEvent } from "../api-types.js";
import { systemClock, type Clock, type TimerHandle } from "../clock.js";
import { EVENTS_TAIL_MS, SSE_KEEPALIVE_MS } from "../constants.js";
import type { SwarmDb } from "../store/db.js";
import { latestEventId, listEventsAfter } from "../store/events.js";
import { getSwarm, listAgentSessions } from "../store/swarm-queries.js";
import { sendJson, type RouteHandler } from "./http.js";
import type { SessionWatcher } from "./sessions.js";

interface Client {
  res: ServerResponse;
  /** `null`: the picker's stream, which only carries `swarm.updated` of every swarm. */
  swarmId: number | null;
}

const TAIL_BATCH = 500;
const ID_PATTERN = /^\d{1,15}$/;

function frame(event: SwarmEvent): string {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  return event.id === null ? data : `id: ${event.id}\n${data}`;
}

function wants(client: Client, event: SwarmEvent): boolean {
  return client.swarmId === null ? event.type === "swarm.updated" : event.swarmId === client.swarmId;
}

export class SseHub {
  readonly route: RouteHandler;
  private readonly db: SwarmDb;
  private readonly clock: Clock;
  private readonly watcher: SessionWatcher;
  private readonly clients = new Set<Client>();
  /** Session watches of every swarm with at least one client: swarm id → stop them all. */
  private readonly watches = new Map<number, () => void>();
  private timers: TimerHandle[] = [];
  /** Newest outbox id already pushed to live clients. */
  private lastSeen = 0;
  private lastError: string | null = null;
  private readonly onError?: (message: string) => void;

  constructor(options: { db: SwarmDb; clock?: Clock; watcher: SessionWatcher; onError?(message: string): void }) {
    this.onError = options.onError;
    this.db = options.db;
    this.clock = options.clock ?? systemClock;
    this.watcher = options.watcher;
    this.route = async (req, res, url) => {
      if (url.pathname !== "/events" || req.method !== "GET") return false;
      this.connect(req, res, url);
      return true;
    };
  }

  start(): void {
    if (this.timers.length > 0) return;
    this.lastSeen = latestEventId(this.db);
    this.timers = [
      this.clock.every(EVENTS_TAIL_MS, () => this.guard(() => this.tail())),
      this.clock.every(SSE_KEEPALIVE_MS, () => this.guard(() => this.writeAll(": keep-alive\n\n"))),
    ];
  }

  stop(): void {
    for (const timer of this.timers) timer.cancel();
    this.timers = [];
    this.closeClients();
  }

  private closeClients(): void {
    for (const client of this.clients) client.res.end();
    this.clients.clear();
    for (const unwatch of this.watches.values()) unwatch();
    this.watches.clear();
  }

  private connect(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const rawSwarm = url.searchParams.get("swarm");
    if (rawSwarm !== null && !ID_PATTERN.test(rawSwarm)) {
      sendJson(res, 400, { error: "bad_request", message: "swarm must be a swarm id.", field: "swarm" });
      return;
    }
    const swarmId = rawSwarm === null ? null : Number(rawSwarm);
    if (swarmId !== null && getSwarm(this.db, swarmId, this.clock.now()) === null) {
      sendJson(res, 404, { error: "not_found", message: `Swarm #${swarmId} not found.` });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    // A first chunk makes the headers reach the client now rather than with the first event.
    res.write(": connected\n\n");
    const client: Client = { res, swarmId };
    this.clients.add(client);
    const leave = () => this.remove(client);
    res.on("close", leave);
    res.on("error", (error: Error) => {
      leave();
      res.destroy();
      if (!("code" in error && (error.code === "ECONNRESET" || error.code === "EPIPE"))) {
        this.report(error);
      }
    });
    try {
      this.replay(client, req.headers["last-event-id"]);
      if (swarmId !== null && !this.watches.has(swarmId)) this.watchSessions(swarmId);
    } catch (error) {
      this.remove(client);
      throw error;
    }
  }

  /** After a reconnect, sends what the client missed up to the point the live tail continues from. */
  private replay(client: Client, lastEventId: string | string[] | undefined): void {
    if (typeof lastEventId !== "string" || !ID_PATTERN.test(lastEventId)) return;
    let after = Number(lastEventId);
    while (after < this.lastSeen) {
      const batch = listEventsAfter(this.db, after, TAIL_BATCH);
      if (batch.length === 0) return;
      for (const event of batch) {
        if (event.id === null || event.id > this.lastSeen) return;
        if (wants(client, event)) client.res.write(frame(event));
        after = event.id;
      }
    }
  }

  private remove(client: Client): void {
    if (!this.clients.delete(client) || client.swarmId === null) return;
    const swarmId = client.swarmId;
    if ([...this.clients].some((other) => other.swarmId === swarmId)) return;
    this.watches.get(swarmId)?.();
    this.watches.delete(swarmId);
  }

  private watchSessions(swarmId: number): void {
    const unwatchers = listAgentSessions(this.db, swarmId).map(({ name, sessionFile }) =>
      this.watcher.watch(name, sessionFile, (newestCursor) =>
        this.guard(() =>
          this.broadcast({
            id: null,
            swarmId,
            type: "session.appended",
            payload: { agent: name, newestCursor },
            createdAt: this.clock.now(),
          }),
        ),
      ),
    );
    this.watches.set(swarmId, () => unwatchers.forEach((unwatch) => unwatch()));
  }

  private guard(task: () => void): void {
    try {
      task();
    } catch (error) {
      this.closeClients();
      this.report(error);
    }
  }

  private report(error: unknown): void {
    const message = `SSE failed: ${error instanceof Error ? error.message : String(error)}`;
    if (message !== this.lastError) {
      this.lastError = message;
      this.onError?.(message);
    }
  }

  private tail(): void {
    if (this.clients.size === 0) {
      this.lastSeen = latestEventId(this.db);
      return;
    }
    for (;;) {
      const batch = listEventsAfter(this.db, this.lastSeen, TAIL_BATCH);
      for (const event of batch) {
        this.broadcast(event);
        if (event.id !== null) this.lastSeen = event.id;
      }
      if (batch.length < TAIL_BATCH) return;
    }
  }

  private broadcast(event: SwarmEvent): void {
    const text = frame(event);
    for (const client of this.clients) if (wants(client, event)) client.res.write(text);
  }

  private writeAll(text: string): void {
    for (const client of this.clients) client.res.write(text);
  }
}
