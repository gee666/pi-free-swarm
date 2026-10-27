import assert from "node:assert/strict";
import { test } from "node:test";
import { SEARCH_EMBEDDING_BATCH } from "../../src/constants.js";
import { runSearch } from "../../src/search/index.js";
import { createTempDb } from "../helpers/temp-db.js";
import { body, documents, helper } from "./fixtures.js";

const embedding = { url: "http://unused/v1/", model: "embedding" };
const helperModel = "fake/folder/model/low";

test("embeddings are batched, fused, reused by hash and recomputed after edits", async () => {
  const temp = createTempDb();
  const batches: string[][] = [];
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "http://unused/v1/embeddings");
    const request = body(init);
    const inputs = request.input;
    assert.equal(request.model, "embedding");
    if (!Array.isArray(inputs) || !inputs.every((input: unknown) => typeof input === "string"))
      throw new Error("bad input");
    const texts: string[] = inputs;
    batches.push(texts);
    return Response.json({
      data: texts.map((text, index) => ({ index, embedding: text.includes("Testing") ? [1, 0] : [0, 1] })).reverse(),
    });
  };
  try {
    const candidates = [
      ...documents,
      ...Array.from({ length: 33 }, (_, id) => ({ id: String(id), title: "other", text: "" })),
    ];
    const options = {
      db: temp.db,
      kind: "post",
      query: "merge",
      candidates,
      settings: { search: { embedding } },
      fetch: fetcher,
    } satisfies Parameters<typeof runSearch>[0];
    const first = await runSearch(options);
    assert.equal(first.mode, "hybrid");
    assert.deepEqual(first.notes, []);
    assert.deepEqual(
      batches.map((batch) => batch.length),
      [1, SEARCH_EMBEDDING_BATCH, 3],
    );
    assert.equal(
      Number(temp.db.sql.prepare("SELECT count(*) AS n FROM search_embeddings").get()?.n),
      candidates.length,
    );
    batches.length = 0;
    await runSearch(options);
    assert.deepEqual(batches, [["merge"]]);
    batches.length = 0;
    await runSearch({
      ...options,
      candidates: candidates.map((doc) => (doc.id === "b" ? { ...doc, text: "changed" } : doc)),
    });
    assert.deepEqual(
      batches.map((batch) => batch.length),
      [1, 1],
    );
    assert.ok(batches[1][0].includes("changed"));
  } finally {
    temp.cleanup();
  }
});

test("helper uses registry selection and auth; HTTP without helper stays lexical", async () => {
  const temp = createTempDb();
  try {
    const options = {
      db: temp.db,
      kind: "criterion",
      query: "merge",
      candidates: documents,
      settings: { helperModel },
    } satisfies Parameters<typeof runSearch>[0];
    const result = await runSearch({ ...options, helper: helper('["b","a"]') });
    assert.equal(result.mode, "reranked");
    assert.equal(result.items[0].id, "b");
    assert.deepEqual(result.notes, []);
    const http = await runSearch(options);
    assert.equal(http.mode, "bm25");
    assert.deepEqual(http.notes, []);
  } finally {
    temp.cleanup();
  }
});

test("helper garbage, duplicates, foreign ids and unavailable models degrade explicitly", async () => {
  const temp = createTempDb();
  try {
    for (const reply of ["not JSON", '["a","a"]', '["b","foreign"]', '["b"]']) {
      const result = await runSearch({
        db: temp.db,
        kind: "task",
        query: "merge",
        candidates: documents,
        settings: { helperModel },
        helper: helper(reply),
      });
      assert.equal(result.mode, "bm25");
      assert.equal(result.items[0].id, "a");
      assert.match(result.notes.join(), /search degraded: reranker failed:/);
    }
    const unavailable = await runSearch({
      db: temp.db,
      kind: "post",
      query: "merge",
      candidates: documents,
      settings: { helperModel: "missing/model/low" },
      helper: helper("[]"),
    });
    assert.match(unavailable.notes.join(), /model not found/);
  } finally {
    temp.cleanup();
  }
});

test("timeouts abort fetch and helper auth, never reject and preserve previous ranking", async () => {
  const temp = createTempDb();
  let signal: AbortSignal | null | undefined;
  const stuck: typeof fetch = async (_url, init) => {
    signal = init?.signal;
    return new Promise<Response>(() => {});
  };
  try {
    const timedOut = await runSearch({
      db: temp.db,
      kind: "post",
      query: "merge",
      candidates: documents,
      settings: { search: { embedding, timeoutMs: 5 } },
      fetch: stuck,
    });
    assert.equal(timedOut.mode, "bm25");
    assert.match(timedOut.notes.join(), /failed: timeout/);
    assert.equal(signal?.aborted, true);
    const stuckHelper = helper("[]");
    stuckHelper.getApiKeyAndHeaders = () => new Promise(() => {});
    const result = await runSearch({
      db: temp.db,
      kind: "post",
      query: "merge",
      candidates: documents,
      settings: { helperModel, search: { timeoutMs: 5 } },
      helper: stuckHelper,
    });
    assert.match(result.notes.join(), /reranker failed: timeout/);
  } finally {
    temp.cleanup();
  }
});

test("bad embedding replies and HTTP errors degrade", async () => {
  const temp = createTempDb();
  try {
    for (const response of [
      Response.json({ data: [] }),
      Response.json({ data: [{ index: 0, embedding: [null] }] }),
      new Response("bad", { status: 503 }),
    ]) {
      const result = await runSearch({
        db: temp.db,
        kind: "post",
        query: "merge",
        candidates: documents,
        settings: { search: { embedding } },
        fetch: async () => response,
      });
      assert.equal(result.mode, "bm25");
      assert.equal(result.items[0].id, "a");
      assert.match(result.notes.join(), /search degraded: embeddings failed:/);
    }
  } finally {
    temp.cleanup();
  }
});
