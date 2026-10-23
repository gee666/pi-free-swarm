import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { addComment, createPost } from "../../src/broker/wall.js";
import { sendMessage } from "../../src/broker/messages.js";
import { bodyLimit } from "../../src/broker/body-limit.js";
import { EVENTS_TAIL_MS } from "../../src/constants.js";
import { bodyCeiling } from "../../src/limits.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { createWatcherToolHandlers } from "../../src/tools/watcher-tools.js";
import { agentToolResult } from "../../src/tools/agent-tool-result.js";
import { FakeClock } from "../agents/fake-clock.js";
import { seedSwarm, T0 } from "../helpers/temp-db.js";
import { isType, openSse, startTestBoard } from "../server/helpers.js";

function attachment(body: string): string {
  const reference = /\[full text: ([^\]]+)\]/.exec(body)?.[1];
  assert.ok(reference, "a long User body must retain a readable attachment reference");
  return reference;
}

test(
  "long User bodies retain exact files through bounded reads and isolated live SSE",
  { timeout: 10_000 },
  async (t) => {
    const clock = new FakeClock(T0);
    const board = await startTestBoard({ clock });
    t.after(() => board.close());
    const { db, cwd } = board.temp;
    const swarm = seedSwarm(db);
    const other = seedSwarm(db, { name: "other" });
    const stream = await openSse(`${board.base}/events?swarm=${swarm.id}`);
    t.after(() => stream.close());
    const handlers = (agentName: string) =>
      createAgentToolHandlers({ getDb: () => db, swarmId: swarm.id, run: 1, agentName, clock });
    const maria = handlers("Maria");
    const john = handlers("John");
    const head = "a".repeat(199) + "🙂";
    const raw = head + "\nTAIL-SENTINEL-漢🙂".repeat(20_000);
    const userPost = createPost(db, swarm.id, "User", { title: "User evidence", text: raw }, T0);
    const postFile = attachment(userPost.text);
    assert.ok(userPost.text.startsWith(head));
    assert.doesNotMatch(userPost.text, /TAIL-SENTINEL/);
    assert.equal(readFileSync(path.resolve(cwd, postFile), "utf8"), raw);
    createPost(db, other.id, "User", { title: "Other swarm", text: raw }, T0);
    clock.advance(EVENTS_TAIL_MS);
    const postFrame = await stream.next(isType("post.created"));
    assert.ok(postFrame.event?.type === "post.created");
    assert.equal(postFrame.event.payload.post.id, userPost.id);
    assert.equal(postFrame.event.payload.post.text, userPost.text);
    assert.ok(Buffer.byteLength(JSON.stringify(postFrame.event)) < 2_000, "the huge file is not inlined into an event");
    assert.ok(stream.frames.every(({ event }) => event === null || event.swarmId === swarm.id));

    const first = maria.readPosts({ only_new: true });
    assert.ok(first.includes(userPost.text));
    assert.match(first, /Complete: true/);
    assert.ok(Buffer.byteLength(first) < 2_000);
    assert.equal((await agentToolResult(first)).details, undefined, "the full stored representation reaches context");
    assert.doesNotMatch(maria.readPosts({ only_new: true }), /User evidence/);
    assert.ok(john.readPosts({ only_new: true }).includes(postFile), "coverage stays isolated between readers");

    const commentRaw = head + "\nCOMMENT-TAIL-漢🙂".repeat(20_000);
    const { comment } = addComment(db, swarm.id, "User", userPost.id, commentRaw, T0 + 1);
    const commentFile = attachment(comment.text);
    assert.equal(readFileSync(path.resolve(cwd, commentFile), "utf8"), commentRaw);
    clock.advance(EVENTS_TAIL_MS);
    const commentFrame = await stream.next(isType("comment.created"));
    assert.ok(commentFrame.event?.type === "comment.created");
    assert.equal(commentFrame.event.payload.comment.id, comment.id);
    assert.equal(commentFrame.event.payload.comment.postId, userPost.id);
    assert.equal(commentFrame.event.payload.comment.text, comment.text);
    const freshComment = maria.readPost({ post_id: userPost.id, only_new: true });
    assert.ok(freshComment.includes(comment.text));
    assert.match(freshComment, /Complete: true/);
    assert.ok(!maria.readPost({ post_id: userPost.id, only_new: true }).includes(commentFile));
    const replay = maria.readPost({ post_id: userPost.id });
    assert.ok(
      replay.includes(postFile) && replay.includes(commentFile),
      "history retains both original file references",
    );

    const questionRaw = head + "\nWATCHER-TAIL-漢🙂".repeat(5_000) + "\nWATCHER-END-UNSEEN";
    const question = sendMessage(db, swarm.id, "User", ["Watcher"], questionRaw, T0 + 2);
    assert.throws(() => maria.readThread({ thread_id: question.threadId }), /not a member/);
    const watcher = createWatcherToolHandlers({
      getDb: () => db,
      swarmId: swarm.id,
      run: 1,
      agentName: "Watcher",
      clock,
    });
    const chunks: string[] = [];
    let after: string | undefined;
    let pages = 0;
    do {
      const page = watcher.threads({ thread_id: question.threadId, after });
      assert.ok(Buffer.byteLength(page) < 30_000);
      assert.equal(
        (await agentToolResult(page)).details,
        undefined,
        "every attachment chunk reaches context untruncated",
      );
      const line = page.split("\n").find((value) => value.startsWith(`#${question.id} `));
      assert.ok(line);
      const content: unknown = JSON.parse(line.slice(line.indexOf(": ") + 2));
      assert.ok(typeof content === "string");
      chunks.push(content);
      after = /Next cursor: (\S+)/.exec(page)?.[1];
      assert.match(page, after ? /Complete: false/ : /Complete: true/);
      pages++;
      assert.ok(pages < 200, "attachment continuation must make bounded forward progress");
    } while (after !== undefined);
    assert.ok(pages > 1, "Watcher tail access must remain paginated");
    assert.equal(
      chunks.join(""),
      questionRaw,
      "Watcher can reconstruct the exact Unicode question, including its final tail",
    );

    const workerShort = createPost(db, swarm.id, "Maria", { title: "Worker boundary", text: "w".repeat(201) }, T0 + 2);
    assert.equal(workerShort.text, "w".repeat(201), "the fixed 200-character User preview does not apply to workers");
    const workerLong = createPost(db, swarm.id, "Maria", { title: "Worker ceiling", text: raw }, T0 + 3);
    assert.ok(
      Array.from(workerLong.text).length <= bodyCeiling(bodyLimit(db)),
      "the existing worker stored-body ceiling remains bounded",
    );
  },
);
