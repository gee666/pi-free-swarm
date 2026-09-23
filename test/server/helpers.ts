// Board server test harness: a temp swarm.db, the API + SSE routes on an OS-chosen port, fetch and SSE clients.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SwarmEvent } from "../../src/api-types.js";
import { systemClock, type Clock } from "../../src/clock.js";
import type { PidAlive } from "../../src/store/locks.js";
import { createApiRoutes } from "../../src/server/api.js";
import { startBoardServer } from "../../src/server/http.js";
import { SessionReader, SessionWatcher } from "../../src/server/sessions.js";
import { SseHub } from "../../src/server/sse.js";
import { createTempDb, type TempDb } from "../helpers/temp-db.js";

/** A pid no process can have (beyond Linux's and macOS's pid ranges). */
export const DEAD_PID = 2 ** 30;
export const WAIT_MS = 5_000;

export const UI_INDEX = "<!doctype html><title>board</title>";
export const UI_ASSET = "console.log('board');";

export const OUTSIDE_SECRET = "outside ui_dist";

/** A minimal ui_dist (app shell, one hashed asset, one plain file) with a file beside it that must stay private. */
export function createUiFixture(): { dir: string; cleanup(): void } {
  const root = mkdtempSync(path.join(tmpdir(), "pi-free-swarm-ui-"));
  const dir = path.join(root, "ui_dist");
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  writeFileSync(path.join(dir, "index.html"), UI_INDEX);
  writeFileSync(path.join(dir, "assets", "index-AbC123.js"), UI_ASSET);
  writeFileSync(path.join(dir, "favicon.svg"), "<svg/>");
  writeFileSync(path.join(root, "secret.txt"), OUTSIDE_SECRET);
  return { dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export interface TestBoard {
  temp: TempDb;
  base: string;
  close(): Promise<void>;
}

export async function startTestBoard(options: { clock?: Clock; alive?: PidAlive } = {}): Promise<TestBoard> {
  const temp = createTempDb();
  const clock = options.clock ?? systemClock;
  const reader = new SessionReader();
  const hub = new SseHub({ db: temp.db, clock, watcher: new SessionWatcher({ reader, clock }) });
  hub.start();
  const api = createApiRoutes({ db: temp.db, clock, sessions: reader, alive: options.alive });
  const ui = createUiFixture();
  const server = await startBoardServer({ candidates: [0], uiDir: ui.dir, routes: [hub.route, api] });
  return {
    temp,
    base: `http://127.0.0.1:${server.port}`,
    async close() {
      hub.stop();
      await server.close();
      temp.cleanup();
      ui.cleanup();
    },
  };
}

export interface JsonResponse<T> {
  status: number;
  headers: Headers;
  body: T;
}

/** `T` is what the test expects; the assertions check it. */
export async function getJson<T = unknown>(url: string): Promise<JsonResponse<T>> {
  const response = await fetch(url);
  return { status: response.status, headers: response.headers, body: await response.json() };
}

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  contentType = "application/json",
): Promise<JsonResponse<T>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

export interface SseFrame {
  id: string | null;
  event: SwarmEvent | null;
  comment: string | null;
}

export interface SseClient {
  frames: SseFrame[];
  /** Resolves with the first frame (already received or future) that matches. */
  next(match: (frame: SseFrame) => boolean, timeoutMs?: number): Promise<SseFrame>;
  close(): void;
}

function parseFrame(block: string): SseFrame {
  const frame: SseFrame = { id: null, event: null, comment: null };
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) frame.comment = line.slice(1).trim();
    else if (line.startsWith("id: ")) frame.id = line.slice(4);
    else if (line.startsWith("data: ")) frame.event = JSON.parse(line.slice(6));
  }
  return frame;
}

export async function openSse(url: string, headers: Record<string, string> = {}): Promise<SseClient> {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  if (response.status !== 200 || response.body === null) throw new Error(`SSE ${url} answered ${response.status}`);
  const frames: SseFrame[] = [];
  const waiters = new Set<() => void>();
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of response.body ?? []) {
        buffer += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          frames.push(parseFrame(buffer.slice(0, end)));
          buffer = buffer.slice(end + 2);
          for (const wake of waiters) wake();
        }
      }
    } catch {
      // Aborted by close().
    }
  })();
  return {
    frames,
    next(match, timeoutMs = WAIT_MS) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const found = frames.find(match);
          if (found === undefined) return;
          waiters.delete(check);
          clearTimeout(timer);
          resolve(found);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`no matching SSE frame within ${timeoutMs} ms (got ${frames.length} frames)`));
        }, timeoutMs);
        waiters.add(check);
        check();
      });
    },
    close: () => controller.abort(),
  };
}

export const isType = (type: SwarmEvent["type"]) => (frame: SseFrame) => frame.event?.type === type;

/** Polls `probe` until it returns a value other than null/undefined. */
export async function waitFor<T>(
  probe: () => T | null | undefined,
  timeoutMs = WAIT_MS,
  label = "condition",
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
