import assert from "node:assert/strict";
import { test } from "node:test";
import { runSearch } from "../../src/search/index.js";
import { SEARCH_RERANK_WINDOW } from "../../src/constants.js";
import { createTempDb } from "../helpers/temp-db.js";
import { helper } from "./fixtures.js";
import { jevKey, jevReply, JEV_KEY_ENV } from "./jev-fixture.js";

const candidates = Array.from({ length: SEARCH_RERANK_WINDOW + 5 }, (_, i) => ({
  id: String(i),
  title: "Query",
  text: "query",
}));
const settings = { search: { jev: { url: "http://jev.test", apiKeyEnv: JEV_KEY_ENV } } };

test("cursor retains the first remotely ranked window and traverses the deterministic tail exactly once", async (t) => {
  const f = createTempDb();
  t.after(() => f.cleanup());
  jevKey(t);
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json(
      jevReply(
        Array.from(
          { length: SEARCH_RERANK_WINDOW },
          (_, i) => (calls === 1 ? i : SEARCH_RERANK_WINDOW - i) / SEARCH_RERANK_WINDOW,
        ),
      ),
    );
  };
  let cursor: string | undefined;
  const seen: string[] = [];
  do {
    const page = await runSearch({
      db: f.db,
      kind: "task",
      candidates,
      query: "query",
      limit: 4,
      settings,
      fetch: fetcher,
      cursor,
    });
    seen.push(...page.items.map((item) => item.id));
    if (page.nextCursor) {
      const raw: unknown = JSON.parse(Buffer.from(page.nextCursor, "base64url").toString());
      assert.ok(typeof raw === "object" && raw !== null && "window" in raw && Array.isArray(raw.window));
      assert.equal(raw.window.length, SEARCH_RERANK_WINDOW);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(calls, 1, "later pages must not invoke a changing reranker");
  assert.deepEqual(
    seen,
    [...candidates.slice(0, SEARCH_RERANK_WINDOW).reverse(), ...candidates.slice(SEARCH_RERANK_WINDOW)].map(
      (item) => item.id,
    ),
  );
  assert.equal(new Set(seen).size, candidates.length);
});

test("a degraded first page stays stable when the reranker recovers, and changed candidates require restart", async (t) => {
  const f = createTempDb();
  t.after(() => f.cleanup());
  jevKey(t);
  const first = await runSearch({
    db: f.db,
    kind: "post",
    candidates,
    query: "query",
    limit: 1,
    settings,
    fetch: async () => {
      throw new Error("down");
    },
  });
  assert.match(first.notes.join(), /jev failed/);
  assert.ok(first.nextCursor);
  let calls = 0;
  const next = await runSearch({
    db: f.db,
    kind: "post",
    candidates,
    query: "query",
    limit: 1,
    settings,
    cursor: first.nextCursor,
    fetch: async () => {
      calls++;
      return Response.json(jevReply([]));
    },
  });
  assert.equal(calls, 0);
  assert.equal(next.items[0]?.id, "1");
  await assert.rejects(
    runSearch({
      db: f.db,
      kind: "post",
      candidates: candidates.slice(1),
      query: "query",
      settings,
      cursor: first.nextCursor,
    }),
    /Restart the search/,
  );
});

test("later pages ignore changing helper order", async (t) => {
  const f = createTempDb();
  t.after(() => f.cleanup());
  const options = {
    db: f.db,
    kind: "task",
    candidates: candidates.slice(0, 3),
    query: "query",
    limit: 1,
    settings: { helperModel: "fake/folder/model/low" },
  } satisfies Parameters<typeof runSearch>[0];
  const first = await runSearch({ ...options, helper: helper('["2","0","1"]') });
  assert.ok(first.nextCursor);
  const second = await runSearch({
    ...options,
    cursor: first.nextCursor,
    helper: helper('["0","2","1"]', () => assert.fail("helper reran")),
  });
  assert.deepEqual([first.items[0]?.id, second.items[0]?.id], ["2", "0"]);
});
