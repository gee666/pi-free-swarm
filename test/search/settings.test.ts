import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadSettings } from "../../src/settings.js";
import { settingsForPersistence } from "../../src/settings-persistence.js";
import { createTempDb } from "../helpers/temp-db.js";

const endpoint = { url: "https://example.com/v1", model: "configured", apiKeyEnv: "SEARCH_TOKEN" };

test("search settings roundtrip without environment secrets", () => {
  const temp = createTempDb();
  try {
    const search = { maxResults: 80, timeoutMs: 1200, embedding: endpoint, reranker: endpoint };
    writeFileSync(
      path.join(temp.db.dataDir, "settings.json"),
      JSON.stringify({ search, helperModel: "provider/folder/model/low" }),
    );
    const { settings, warnings } = loadSettings(temp.cwd, { globalFile: null });
    assert.deepEqual(settings.search, search);
    assert.equal(settings.helperModel, "provider/folder/model/low");
    assert.deepEqual(warnings, []);
    assert.deepEqual(settingsForPersistence(settings).search, search);
  } finally {
    temp.cleanup();
  }
});

test("invalid search configuration has field-specific errors", () => {
  const temp = createTempDb();
  const examples: [unknown, RegExp][] = [
    [{ search: [] }, /search must be an object/],
    [{ search: { maxResults: 0 } }, /search.maxResults/],
    [{ search: { timeoutMs: 0.1 } }, /search.timeoutMs/],
    [{ search: { embedding: { ...endpoint, url: "file:///tmp" } } }, /search.embedding.url/],
    [{ search: { reranker: { ...endpoint, url: "https://user:secret@example.com" } } }, /search.reranker.url/],
    [{ search: { embedding: { ...endpoint, model: " " } } }, /search.embedding.model/],
    [{ search: { embedding: { ...endpoint, apiKeyEnv: "actual key" } } }, /search.embedding.apiKeyEnv/],
    [{ helperModel: "provider/model" }, /helperModel/],
    [{ helperModel: "provider/model/unknown" }, /helperModel thinking/],
  ];
  try {
    for (const [value, pattern] of examples) {
      writeFileSync(path.join(temp.db.dataDir, "settings.json"), JSON.stringify(value));
      assert.throws(() => loadSettings(temp.cwd, { globalFile: null }), pattern);
    }
  } finally {
    temp.cleanup();
  }
});
