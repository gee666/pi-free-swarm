import { vi } from "vitest";

export interface ApiCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

type Handler = (call: ApiCall) => unknown;

export interface FakeApi {
  /** Every request so far, in order. */
  calls: ApiCall[];
  /** Answers `method path` (exact path, query ignored); a returned Response is sent as is, anything else as JSON. */
  on: (method: string, path: string, handler: Handler) => void;
  callsTo: (method: string, path: string) => ApiCall[];
}

export const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Replaces `fetch` with a router over registered handlers; unknown routes answer 404. */
export function installFakeApi(): FakeApi {
  const handlers = new Map<string, Handler>();
  const calls: ApiCall[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input), "http://board.test");
    const text = typeof init?.body === "string" ? init.body : undefined;
    const call: ApiCall = {
      method: init?.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      body: text === undefined ? undefined : JSON.parse(text),
    };
    calls.push(call);
    const handler = handlers.get(`${call.method} ${call.path}`);
    if (!handler) return jsonResponse(404, { error: "not_found", message: `No fake for ${call.method} ${call.path}` });
    const result = handler(call);
    return result instanceof Response ? result : jsonResponse(200, result);
  });
  return {
    calls,
    on: (method, path, handler) => handlers.set(`${method} ${path}`, handler),
    callsTo: (method, path) => calls.filter((call) => call.method === method && call.path === path),
  };
}
