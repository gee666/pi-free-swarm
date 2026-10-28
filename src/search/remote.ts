import type { SearchEndpoint } from "./settings.js";

export async function withTimeout<T>(timeoutMs: number, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, action(controller.signal)]);
  } finally {
    clearTimeout(timer);
  }
}

export async function postJson(
  endpoint: Pick<SearchEndpoint, "url" | "apiKeyEnv">,
  url: string,
  body: unknown,
  signal: AbortSignal,
  fetcher: typeof fetch,
  env: Record<string, string>,
): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (endpoint.apiKeyEnv !== undefined) {
    const apiKey = env[endpoint.apiKeyEnv] ?? process.env[endpoint.apiKeyEnv];
    if (!apiKey) throw new Error(`missing API key environment variable ${endpoint.apiKeyEnv}`);
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const response = await fetcher(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function failureNote(stage: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : "unknown error";
  return `search degraded: ${stage} failed: ${reason}`;
}
