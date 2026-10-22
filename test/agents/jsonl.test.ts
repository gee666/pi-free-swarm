import assert from "node:assert/strict";
import { test } from "node:test";
import { createJsonlSplitter, RpcFrameOverflowError } from "../../src/agents/jsonl.js";

test("frame bound counts UTF-8 bytes across arbitrary chunks", () => {
  const lines: string[] = [];
  const line = JSON.stringify({ text: "你好🙂\u2028\u2029" });
  const bytes = Buffer.from(line);
  const splitter = createJsonlSplitter((text) => lines.push(text), bytes.length);
  for (const byte of bytes) splitter.push(Buffer.from([byte]));
  assert.equal(splitter.bufferedBytes, bytes.length);
  splitter.push(Buffer.from("\n"));
  assert.deepEqual(lines, [line]);
  assert.equal(splitter.bufferedBytes, 0);
});

test("complete and unfinished oversized frames fail without retaining data or emitting a tail", () => {
  for (const newline of ["", "\n"]) {
    const lines: string[] = [];
    const splitter = createJsonlSplitter((line) => lines.push(line), 10);
    splitter.push(Buffer.from("12345"));
    assert.throws(() => splitter.push(Buffer.from(`678901${newline}`)), RpcFrameOverflowError);
    assert.equal(splitter.bufferedBytes, 0);
    splitter.push(Buffer.from("ignored\n"));
    splitter.end();
    assert.deepEqual(lines, []);
  }
});

test("limit applies per frame, not per chunk or total stream", () => {
  const lines: string[] = [];
  const splitter = createJsonlSplitter((line) => lines.push(line), 4);
  splitter.push(Buffer.from("abcd\nab\ncd\n"));
  splitter.end();
  assert.deepEqual(lines, ["abcd", "ab", "cd"]);
});

test("large legitimate Unicode record survives default policy", () => {
  const line = JSON.stringify({ result: "🙂漢字".repeat(200_000) });
  const lines: string[] = [];
  const splitter = createJsonlSplitter((value) => lines.push(value));
  splitter.push(Buffer.from(line));
  splitter.end();
  assert.deepEqual(lines, [line]);
});
