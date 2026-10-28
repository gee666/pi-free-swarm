import assert from "node:assert/strict";
import { test } from "node:test";
import { runSearch } from "../../src/search/index.js";
import { createTempDb } from "../helpers/temp-db.js";
import { documents } from "./fixtures.js";
import { jevReply } from "./jev-fixture.js";

const keyName = "SEARCH_CREDENTIALS_TEST_KEY";

test("search endpoints resolve keys from settings before the process environment", async (t) => {
  const previous = process.env[keyName];
  t.after(() => {
    if (previous === undefined) delete process.env[keyName];
    else process.env[keyName] = previous;
  });
  for (const stage of ["embedding", "jev"] as const) {
    for (const source of ["settings", "process", "missing"] as const) {
      await t.test(`${stage}: ${source}`, async (t) => {
        const temp = createTempDb();
        t.after(() => temp.cleanup());
        if (source === "missing") delete process.env[keyName];
        else process.env[keyName] = "process-key";
        const endpoint = { url: "http://unused", apiKeyEnv: keyName };
        const search = stage === "embedding" ? { embedding: { ...endpoint, model: "embed" } } : { jev: endpoint };
        let requests = 0;
        const result = await runSearch({
          db: temp.db,
          kind: "post",
          query: "merge",
          candidates: documents,
          settings: { search, env: source === "settings" ? { [keyName]: "settings-key" } : {} },
          fetch: async (_url, init) => {
            requests++;
            assert.deepEqual(init?.headers, {
              "Content-Type": "application/json",
              Authorization: `Bearer ${source === "settings" ? "settings-key" : "process-key"}`,
            });
            if (stage === "jev") return Response.json(jevReply([0.1, 0.9]));
            const body = JSON.parse(String(init?.body));
            return Response.json({
              data: body.input.map((_: string, index: number) => ({ index, embedding: [1, 0] })),
            });
          },
        });
        if (source === "missing") {
          assert.equal(requests, 0);
          assert.deepEqual(result.notes, [
            `search degraded: ${stage === "embedding" ? "embeddings" : "jev"} failed: missing API key environment variable ${keyName}`,
          ]);
        } else {
          assert.ok(requests > 0);
          assert.deepEqual(result.notes, []);
          assert.equal(result.mode, stage === "embedding" ? "hybrid" : "reranked");
        }
      });
    }
  }
});
