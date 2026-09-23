import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getJson, postJson } from "./http";

const respond = (status: number, body: string, contentType = "application/json") =>
  vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(body, { status, headers: { "Content-Type": contentType } }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("http", () => {
  it("returns the parsed body and posts JSON", async () => {
    const fetch = respond(200, '{"ok":true}');
    await expect(postJson<{ ok: boolean }>("/api/x", { text: "hi" })).resolves.toEqual({ ok: true });
    const init = fetch.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"text":"hi"}');
  });

  it("throws ApiError with the server's code and message", async () => {
    respond(409, '{"error":"swarm_not_running","message":"Swarm is not running."}');
    const error = await getJson("/api/x").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "swarm_not_running", message: "Swarm is not running." });
  });

  it("falls back to the status line for non-JSON errors", async () => {
    respond(502, "<html>Bad gateway</html>", "text/html");
    await expect(getJson("/api/x")).rejects.toMatchObject({ status: 502, code: undefined, message: "502" });
  });
});
