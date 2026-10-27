import assert from "node:assert/strict";
import { test } from "node:test";
import { bm25, cosineSimilarity, reciprocalRankFusion, tokenize } from "../../src/search/ranking.js";
import { runSearch } from "../../src/search/index.js";
import { createTempDb } from "../helpers/temp-db.js";

const docs = [
  { id: "body", title: "General notes", text: "merge safely" },
  { id: "title", title: "Merge safely", text: "general notes" },
  { id: "other", title: "Other topic", text: "testing linters" },
];

test("tokenizer splits identifiers, keeps Unicode and removes simple stopwords", () => {
  assert.deepEqual(tokenize("The snake_case camelCase HTTPServer v2 версия42 中文"), [
    "snake",
    "case",
    "camel",
    "case",
    "http",
    "server",
    "v2",
    "версия42",
    "中文",
  ]);
});

test("BM25 favors title hits, rare terms and repeated hits; ties retain input order", () => {
  assert.deepEqual(
    bm25("merge", docs).map((doc) => doc.id),
    ["title", "body", "other"],
  );
  const corpus = [
    { id: "one", title: "", text: "apple pear pear" },
    { id: "two", title: "", text: "apple apple pear" },
    { id: "rare", title: "", text: "rare pear pear" },
  ];
  assert.equal(bm25("apple", corpus)[0].id, "two");
  assert.equal(bm25("rare pear", corpus)[0].id, "rare");
  assert.deepEqual(bm25("notpresent", docs), docs);
  assert.deepEqual(bm25("", []), []);
});

test("RRF combines ordinal ranks rather than raw scores", () => {
  const [a, b, c] = docs;
  assert.deepEqual(
    reciprocalRankFusion([
      [a, b, c],
      [c, b, a],
      [b, c, a],
    ]).map((doc) => doc.id),
    [b.id, c.id, a.id],
  );
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 2], [1, 2]), 1);
  assert.throws(() => cosineSimilarity([0], [1]), /norm/);
});

test("filter-only preserves supplied recency order; cursor rejects changed query or candidates", async () => {
  const temp = createTempDb();
  try {
    const options = { db: temp.db, kind: "post", candidates: docs } satisfies Parameters<typeof runSearch>[0];
    const first = await runSearch({ ...options, limit: 1 });
    assert.equal(first.mode, "filter");
    assert.deepEqual(first.items, [docs[0]]);
    assert.ok(first.nextCursor);
    const next = await runSearch({ ...options, limit: 2, cursor: first.nextCursor });
    assert.deepEqual(next.items, docs.slice(1));
    assert.equal(next.nextCursor, null);
    const changes: { query?: string; candidates?: typeof docs }[] = [{ query: "merge" }, { candidates: docs.slice(1) }];
    for (const change of changes) {
      await assert.rejects(runSearch({ ...options, ...change, cursor: first.nextCursor }), /Restart the search/);
    }
    await assert.rejects(runSearch({ ...options, cursor: "garbage" }), /cursor/);
    const ranked = await runSearch({ ...options, query: "merge", limit: 1 });
    assert.equal(ranked.items[0].id, "title");
  } finally {
    temp.cleanup();
  }
});

test("pagination defaults to ten, respects configured max and hard cap fifty", async () => {
  const temp = createTempDb();
  try {
    const options = {
      db: temp.db,
      kind: "task",
      candidates: Array.from({ length: 80 }, (_, id) => ({ id: String(id), title: "", text: "" })),
    } satisfies Parameters<typeof runSearch>[0];
    assert.equal((await runSearch(options)).items.length, 10);
    assert.equal((await runSearch({ ...options, limit: 80 })).items.length, 20);
    assert.equal((await runSearch({ ...options, limit: 80, settings: { search: { maxResults: 3 } } })).items.length, 3);
    assert.equal(
      (await runSearch({ ...options, limit: 80, settings: { search: { maxResults: 100 } } })).items.length,
      50,
    );
  } finally {
    temp.cleanup();
  }
});
