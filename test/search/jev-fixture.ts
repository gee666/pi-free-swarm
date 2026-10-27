import { createServer } from "node:http";
import type { TestContext } from "node:test";

export const JEV_KEY_ENV = "SEARCH_TEST_JEV_KEY";
export const JEV_KEY = "test-jev-secret";

export function jevKey(t: TestContext): void {
  const previous = process.env[JEV_KEY_ENV];
  process.env[JEV_KEY_ENV] = JEV_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env[JEV_KEY_ENV];
    else process.env[JEV_KEY_ENV] = previous;
  });
}

export function jevReply(scores: readonly number[]): unknown {
  return {
    model: "jev-latest",
    answers: Object.fromEntries(scores.map((noul, index) => [`d${index + 1}`, { type: "noul", noul }])),
    usage: {},
  };
}

interface JevRequest {
  path: string | undefined;
  authorization: string | undefined;
  contentType: string | undefined;
  body: unknown;
}

export async function fakeJev(
  t: TestContext,
  reply: { body?: unknown; raw?: string; status?: number },
): Promise<{ url: string; requests: JevRequest[] }> {
  jevKey(t);
  const requests: JevRequest[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const parsed: unknown = JSON.parse(body);
    requests.push({
      path: request.url,
      authorization: request.headers.authorization,
      contentType: request.headers["content-type"],
      body: parsed,
    });
    if (reply.body === undefined && reply.raw === undefined) return;
    response.writeHead(reply.status ?? 200, { "Content-Type": "application/json" });
    response.end(reply.raw ?? JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing test server address");
  return { url: `http://127.0.0.1:${address.port}`, requests };
}
