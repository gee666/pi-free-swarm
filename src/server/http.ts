// The board's node:http server: API and SSE routes first, then the built UI from ui_dist/ with an SPA fallback.
import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import type { ApiErrorBody } from "../api-types.js";
import { SERVER_BIND_HOST } from "../constants.js";

/** Resolves `false` when the request is not this handler's, so the next one gets it. */
export type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>;

export interface BoardServer {
  port: number;
  close(): Promise<void>;
}

/** Every candidate port was taken by another program. */
export class PortsInUseError extends Error {
  constructor(readonly ports: readonly number[]) {
    super(`Ports in use: ${ports.join(", ")}`);
    this.name = "PortsInUseError";
  }
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
/** Vite puts content-hashed files here, so they never change under the same URL. */
const HASHED_ASSETS_PREFIX = "/assets/";
const IMMUTABLE = "public, max-age=31536000, immutable";

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function notFound(res: ServerResponse, url: URL, method: string): void {
  const body: ApiErrorBody = { error: "not_found", message: `No route for ${method} ${url.pathname}.` };
  sendJson(res, 404, body);
}

function isFile(file: string): boolean {
  return statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** The file under `uiDir` for a URL path; `null` for paths that are malformed or escape the directory. */
function staticPath(uiDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.resolve(uiDir, `.${decoded}`);
  return file === uiDir || file.startsWith(uiDir + path.sep) ? file : null;
}

function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL, uiDir: string): void {
  const requested = staticPath(uiDir, url.pathname);
  const index = path.join(uiDir, "index.html");
  // Deep links like /s/3/agents are client-side routes: answer them with the app shell.
  const file = requested !== null && isFile(requested) ? requested : index;
  if (!isFile(file)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("The board UI is not built (ui_dist/index.html is missing).");
    return;
  }
  const hashed = file !== index && url.pathname.startsWith(HASHED_ASSETS_PREFIX);
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": statSync(file).size,
    "Cache-Control": hashed ? IMMUTABLE : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
}

function createHandler(uiDir: string, routes: readonly RouteHandler[]) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${SERVER_BIND_HOST}`);
    try {
      for (const route of routes) if (await route(req, res, url)) return;
    } catch (error) {
      console.error("[pi-free-swarm] board request failed:", error);
      if (res.headersSent) res.destroy();
      else sendJson(res, 500, { error: "internal", message: "Internal server error." } satisfies ApiErrorBody);
      return;
    }
    const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname === "/events";
    if (isApi || (method !== "GET" && method !== "HEAD")) notFound(res, url, method);
    else serveStatic(req, res, url, uiDir);
  };
}

function listen(server: Server, port: number): Promise<number | "in_use"> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      if ("code" in error && error.code === "EADDRINUSE") resolve("in_use");
      else reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, SERVER_BIND_HOST);
  });
}

/** Binds the first free candidate; port 0 lets the OS choose. Rejects with `PortsInUseError` when all are taken. */
export async function startBoardServer(options: {
  candidates: readonly number[];
  uiDir: string;
  routes: readonly RouteHandler[];
}): Promise<BoardServer> {
  const handler = createHandler(path.resolve(options.uiDir), options.routes);
  for (const candidate of options.candidates) {
    const server = createServer((req, res) => void handler(req, res));
    const port = await listen(server, candidate);
    if (port === "in_use") continue;
    return {
      port,
      close: () =>
        new Promise((resolve) => {
          server.close(() => resolve());
          // SSE and keep-alive sockets would hold close() open indefinitely.
          server.closeAllConnections();
        }),
    };
  }
  throw new PortsInUseError(options.candidates);
}
