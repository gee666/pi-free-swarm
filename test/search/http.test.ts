import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { CriteriaResponse, SearchConfigResponse } from "../../src/api-types.js";
import { SEARCH_JEV_MODEL } from "../../src/search/settings.js";
import { getJson } from "../server/helpers.js";
import { createHttpCriterion, workBoard } from "../server/work-helpers.js";
import { fakeJev, jevReply, JEV_KEY_ENV } from "./jev-fixture.js";

test("HTTP searches use JEV and retain the ranked cursor window; config shows its default model without secrets", async (t) => {
  const jev = await fakeJev(t, { body: jevReply([0.1, 0.9]) });
  const board = await workBoard();
  t.after(() => board.close());
  const first = await createHttpCriterion(board, { title: "Target HTTP" });
  const second = await createHttpCriterion(board, { title: "Other HTTP" });
  writeFileSync(
    path.join(board.temp.db.dataDir, "settings.json"),
    JSON.stringify({
      helperModel: "missing/model/off",
      search: { jev: { url: jev.url, apiKeyEnv: JEV_KEY_ENV } },
    }),
  );
  const config = await getJson<SearchConfigResponse>(board.url("/search-config"));
  assert.equal(config.status, 200);
  assert.equal(config.body.reranker, `JEV ${SEARCH_JEV_MODEL}`);
  assert.ok(!JSON.stringify(config.body).includes(JEV_KEY_ENV));
  assert.ok(!JSON.stringify(config.body).includes(jev.url));
  const query = "/criteria?group=HTTP&query=Target&limit=1";
  const page = await getJson<CriteriaResponse>(board.url(query));
  assert.equal(page.status, 200);
  assert.equal(page.body.mode, "reranked");
  assert.deepEqual(page.body.notes, []);
  assert.equal(page.body.items[0]?.id, second.id);
  assert.ok(page.body.nextCursor);
  const next = await getJson<CriteriaResponse>(board.url(`${query}&cursor=${page.body.nextCursor}`));
  assert.equal(next.status, 200);
  assert.equal(next.body.items[0]?.id, first.id);
  assert.equal(next.body.nextCursor, null);
  assert.equal(jev.requests.length, 1);
});
