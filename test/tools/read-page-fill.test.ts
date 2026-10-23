import assert from "node:assert/strict";
import { statSync } from "node:fs";
import path from "node:path";
import { after, it } from "node:test";
import { createPost } from "../../src/broker/wall.js";
import { readUserAttachmentChunk } from "../../src/broker/user-attachment.js";
import { readPosition, renderReadPage, type ReadItem } from "../../src/tools/read-page.js";
import { agentToolResult } from "../../src/tools/agent-tool-result.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());

async function readSource(original: string) {
  const swarm = seedSwarm(temp.db);
  const post = createPost(temp.db, swarm.id, "User", { title: "Performance source", text: original }, T0);
  const size = statSync(path.join(temp.db.dataDir, "attachments", String(swarm.id), `post-${post.id}.md`)).size;
  let physicalReads = 0;
  let physicalBytes = 0;
  let largestRead = 0;
  const item: ReadItem = {
    id: post.id,
    label: `#${post.id} User`,
    text: post.text,
    readChunk(offset, maxBytes) {
      const allocated = Math.min(maxBytes, size - offset);
      physicalBytes += allocated;
      physicalReads++;
      largestRead = Math.max(largestRead, allocated);
      return readUserAttachmentChunk(temp.db, swarm.id, "post", post.id, offset, maxBytes);
    },
  };
  let after: string | undefined;
  let pages = 0;
  let largestPageRead = 0;
  const parts: string[] = [];
  do {
    const before = physicalBytes;
    const position = readPosition(after, `perf:${swarm.id}`, post.id);
    const page = renderReadPage("Bounded source", [item], position, 1);
    largestPageRead = Math.max(largestPageRead, physicalBytes - before);
    assert.ok(Buffer.byteLength(page.text) < 25_000);
    assert.equal((await agentToolResult(page.text)).details, undefined);
    const line = page.text.split("\n").find((value) => value.startsWith("#"));
    assert.ok(line);
    const value: unknown = JSON.parse(line.slice(line.indexOf(': "') + 2));
    assert.ok(typeof value === "string");
    parts.push(value);
    after = /Next cursor: (\S+)/.exec(page.text)?.[1];
    assert.deepEqual(page.completeIds, after === undefined ? [post.id] : []);
    assert.ok(++pages < 200);
  } while (after !== undefined);
  assert.equal(parts.join(""), original);
  assert.ok(largestRead <= 24_000);
  assert.ok(largestPageRead <= 48_000);
  // A UTF-8 record boundary may reread at most three trailing bytes, never a whole discarded range.
  assert.ok(physicalBytes <= size + physicalReads * 3);
  return { pages, physicalBytes, physicalReads, largestRead, largestPageRead, sourceBytes: size };
}

it("rejects a changed or nonadvancing source instead of advancing unseen coverage", () => {
  const position = { scope: "invalid", snapshot: 1, id: 1, offset: 0 };
  assert.throws(
    () =>
      renderReadPage(
        "Source",
        [{ id: 1, label: "#1 User", text: "", readChunk: () => ({ text: "", nextOffset: 0 }) }],
        position,
        1,
      ),
    /did not advance/,
  );
  let calls = 0;
  assert.throws(
    () =>
      renderReadPage(
        "Source",
        [{ id: 1, label: "#1 User", text: "", readChunk: () => (calls++ === 0 ? { text: "a", nextOffset: 1 } : null) }],
        position,
        1,
      ),
    /changed during/,
  );
  assert.throws(
    () =>
      renderReadPage(
        "Source",
        [{ id: 1, label: "#1 User", text: "", readChunk: () => ({ text: "x".repeat(24_001), nextOffset: null }) }],
        position,
        1,
      ),
    /exceeded this read budget/,
  );
});

it("fills bounded pages for a100KB source instead of one model/tool turn per3KB range", async (t) => {
  const stats = await readSource("a".repeat(100_000));
  t.diagnostic(JSON.stringify(stats));
  assert.ok(stats.pages <= 5, JSON.stringify(stats));
});

it("preserves Unicode ranges and exact whitespace while keeping physical IO bounded", async (t) => {
  const stats = await readSource(" \n" + "🙂漢\n".repeat(12_500) + "TAIL  ");
  t.diagnostic(JSON.stringify(stats));
  assert.ok(stats.pages <= 6, JSON.stringify(stats));
});

it("handles worst-case JSON escaping without oversized output, early coverage or repeated whole ranges", async (t) => {
  const stats = await readSource("A" + '\u0000\n\\"'.repeat(10_000) + "TAIL");
  t.diagnostic(JSON.stringify(stats));
  assert.ok(stats.pages < 20, JSON.stringify(stats));
});
