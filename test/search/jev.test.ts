import assert from "node:assert/strict";
import { test } from "node:test";
import { SEARCH_RERANK_WINDOW } from "../../src/constants.js";
import { runSearch } from "../../src/search/index.js";
import { SEARCH_JEV_DOCUMENT_CHARS } from "../../src/search/reranking.js";
import { SEARCH_JEV_MODEL, SEARCH_JEV_TIMEOUT_MS } from "../../src/search/settings.js";
import { createTempDb } from "../helpers/temp-db.js";
import { documents, helper } from "./fixtures.js";
import { fakeJev, jevKey, jevReply, JEV_KEY, JEV_KEY_ENV } from "./jev-fixture.js";

test("JEV sends one authenticated request with bounded documents and takes precedence over the helper", async (t) => {
  const scores = Array.from({ length: SEARCH_RERANK_WINDOW }, (_, index) => index / SEARCH_RERANK_WINDOW);
  const server = await fakeJev(t, { body: jevReply(scores) });
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const candidates = Array.from({ length: 40 }, (_, index) => ({
    id: String(index),
    title: "merge",
    text: "x".repeat(SEARCH_JEV_DOCUMENT_CHARS * 2),
  }));
  const result = await runSearch({
    db: temp.db,
    kind: "task",
    query: "merge",
    candidates,
    settings: {
      search: { jev: { url: `${server.url}/`, apiKeyEnv: JEV_KEY_ENV } },
      helperModel: "fake/folder/model/low",
    },
    helper: helper("[]", () => assert.fail("JEV must take precedence")),
  });
  assert.equal(result.mode, "reranked");
  assert.equal(result.items[0]?.id, "29");
  assert.deepEqual(result.notes, []);
  assert.equal(server.requests.length, 1);
  const [request] = server.requests;
  assert.ok(request);
  assert.equal(request.path, "/v1/systemone");
  assert.equal(request.authorization, `Bearer ${JEV_KEY}`);
  assert.equal(request.contentType, "application/json");
  assert.deepEqual(request.body, {
    model: SEARCH_JEV_MODEL,
    state: {
      query: "merge",
      documents: candidates.slice(0, SEARCH_RERANK_WINDOW).map((document, index) => ({
        id: `d${index + 1}`,
        text: `${document.title}\n${document.text}`.slice(0, SEARCH_JEV_DOCUMENT_CHARS),
      })),
    },
    questions: Object.fromEntries(
      scores.map((_, index) => {
        const id = `d${index + 1}`;
        return [
          id,
          { type: "noul", instructions: `Is document ${id} relevant to the search query? Judge only document ${id}.` },
        ];
      }),
    ),
  });
});

test("HTTP callers can use JEV without a helper, and ties keep the previous order", async (t) => {
  const server = await fakeJev(t, { body: jevReply([0.5, 0.5]) });
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const result = await runSearch({
    db: temp.db,
    kind: "post",
    query: "merge",
    candidates: documents,
    settings: { search: { jev: { url: server.url, apiKeyEnv: JEV_KEY_ENV, model: "custom-jev" } } },
  });
  assert.equal(result.mode, "reranked");
  assert.deepEqual(
    result.items.map((item) => item.id),
    ["a", "b"],
  );
  assert.deepEqual(result.notes, []);
  assert.ok(server.requests[0]?.body && typeof server.requests[0].body === "object");
  assert.ok("model" in server.requests[0].body);
  assert.equal(server.requests[0].body.model, "custom-jev");
});

test("JEV validates every answer and degrades without calling the helper", async (t) => {
  const badReplies = [
    {},
    { answers: {} },
    { model: "jev", answers: {} },
    { model: "jev", answers: { d1: { type: "noul", noul: 0.5 } } },
    { model: "jev", answers: { d1: { type: "noul", noul: 0.5 }, foreign: { type: "noul", noul: 0.1 } } },
    ...[null, "0.5", -0.1, 1.1].map((noul) => ({
      model: "jev",
      answers: { d1: { type: "noul", noul }, d2: { type: "noul", noul: 0.1 } },
    })),
    { model: "jev", answers: { d1: { type: "bool", noul: 0.5 }, d2: { type: "noul", noul: 0.1 } } },
  ];
  for (const [index, body] of badReplies.entries()) {
    await t.test(`malformed reply ${index}`, async (t) => {
      const server = await fakeJev(t, { body });
      const temp = createTempDb();
      t.after(() => temp.cleanup());
      const result = await runSearch({
        db: temp.db,
        kind: "criterion",
        query: "merge",
        candidates: documents,
        settings: {
          search: { jev: { url: server.url, apiKeyEnv: JEV_KEY_ENV } },
          helperModel: "fake/folder/model/low",
        },
        helper: helper("[]", () => assert.fail("failed JEV must not invoke helper")),
      });
      assert.equal(result.mode, "bm25");
      assert.deepEqual(result.items, documents);
      assert.match(result.notes.join(), /search degraded: jev failed: invalid JEV/);
    });
  }
});

test("JEV HTTP errors and invalid JSON retain the previous ranking", async (t) => {
  for (const status of [200, 400, 401, 422, 429, 503]) {
    await t.test(`HTTP ${status}`, async (t) => {
      const server = await fakeJev(t, { status, raw: "not JSON" });
      const temp = createTempDb();
      t.after(() => temp.cleanup());
      const result = await runSearch({
        db: temp.db,
        kind: "post",
        query: "merge",
        candidates: documents,
        settings: { search: { jev: { url: server.url, apiKeyEnv: JEV_KEY_ENV } } },
      });
      assert.equal(result.mode, "bm25");
      assert.deepEqual(result.items, documents);
      assert.match(result.notes.join(), /search degraded: jev failed:/);
      if (status !== 200) assert.match(result.notes.join(), new RegExp(`HTTP ${status}`));
      assert.equal(server.requests.length, 1, "failed requests must not be retried");
      assert.ok(!result.notes.join().includes(JEV_KEY));
    });
  }
});

test("JEV timeout bounds a stalled server and keeps lexical ranking", async (t) => {
  const server = await fakeJev(t, {});
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const result = await runSearch({
    db: temp.db,
    kind: "post",
    query: "merge",
    candidates: documents,
    settings: { search: { jev: { url: server.url, apiKeyEnv: JEV_KEY_ENV, timeoutMs: 100 } } },
  });
  assert.equal(server.requests.length, 1);
  assert.equal(result.mode, "bm25");
  assert.deepEqual(result.items, documents);
  assert.deepEqual(result.notes, ["search degraded: jev failed: timeout"]);
});

test("JEV uses its own longer default deadline rather than search.timeoutMs", async (t) => {
  jevKey(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const deferred: { resolve?: (response: Response) => void } = {};
  const response = new Promise<Response>((resolve) => {
    deferred.resolve = resolve;
  });
  const pending = runSearch({
    db: temp.db,
    kind: "post",
    query: "merge",
    candidates: documents,
    settings: { search: { timeoutMs: 1, jev: { url: "http://unused", apiKeyEnv: JEV_KEY_ENV } } },
    fetch: () => response,
  });
  t.mock.timers.tick(SEARCH_JEV_TIMEOUT_MS - 1);
  assert.ok(deferred.resolve);
  deferred.resolve(Response.json(jevReply([0.1, 0.9])));
  const result = await pending;
  assert.equal(result.mode, "reranked");
  assert.equal(result.items[0]?.id, "b");
  assert.deepEqual(result.notes, []);
});

test("missing JEV credentials produce a note without making a request", async (t) => {
  const temp = createTempDb();
  t.after(() => temp.cleanup());
  const result = await runSearch({
    db: temp.db,
    kind: "post",
    query: "merge",
    candidates: documents,
    settings: { search: { jev: { url: "http://unused", apiKeyEnv: "SEARCH_JEV_NONEXISTENT_TEST_KEY" } } },
    fetch: () => assert.fail("no key must mean no request"),
  });
  assert.equal(result.mode, "bm25");
  assert.match(result.notes.join(), /search degraded: jev failed: missing API key environment variable/);
});
