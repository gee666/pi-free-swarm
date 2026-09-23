/** Non-2xx response. `code` is the server's `error` field, e.g. "swarm_not_running". */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function stringField(body: unknown, key: "error" | "message"): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value: unknown = Reflect.get(body, key);
  return typeof value === "string" ? value : undefined;
}

function toApiError(response: Response, text: string): ApiError {
  // Proxies and crashes can answer with HTML; only JSON bodies carry error details.
  const isJson = response.headers.get("Content-Type")?.includes("application/json") ?? false;
  const body: unknown = isJson && text ? JSON.parse(text) : undefined;
  const code = stringField(body, "error");
  const message = stringField(body, "message") ?? code ?? `${response.status} ${response.statusText}`.trim();
  return new ApiError(response.status, code, message);
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Accept: "application/json", ...init.headers } });
  const text = await response.text();
  if (!response.ok) throw toApiError(response, text);
  // The board server is the only producer; payload shapes are defined in src/api-types.ts.
  return JSON.parse(text || "null");
}

export function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return request<T>(url, { signal });
}

export function postJson<T>(url: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(url, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    signal,
  });
}
