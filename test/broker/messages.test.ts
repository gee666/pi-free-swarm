import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sendMessage,
  readConversation,
  readThreadAs,
  markUserRead,
  sendMainFeedback,
} from "../../src/broker/messages.js";
import { getMessages } from "../../src/store/message-queries.js";
import { endRun } from "../../src/broker/swarms.js";
import { workFixture } from "../helpers/work-graph.js";
import { T0 } from "../helpers/temp-db.js";

test("direct sends reuse the same conversation in either direction and page history", (t) => {
  const f = workFixture(t);
  const first = sendMessage(f.db, { swarmId: f.swarmId, from: "Ann", to: "ben", text: "One", now: T0 });
  const second = sendMessage(f.db, { swarmId: f.swarmId, from: "Ben", to: "Ann", text: "Two", now: T0 });
  assert.equal(first.threadId, second.threadId);
  assert.deepEqual(
    first.recipients.map((recipient) => recipient.name),
    ["Ben"],
  );
  const page = readConversation(f.db, { swarmId: f.swarmId, a: "Ann", b: "Ben", limit: 1 });
  assert.deepEqual(
    page.messages.map((message) => message.text),
    ["One"],
  );
  assert.equal(page.nextAfter, first.id);
  assert.deepEqual(
    readConversation(f.db, { swarmId: f.swarmId, a: "Ann", b: "Ben", after: first.id }).messages.map(
      (message) => message.text,
    ),
    ["Two"],
  );
  assert.throws(() => readThreadAs(f.db, f.swarmId, "Cam", first.threadId), /not a member/);
  assert.equal(readConversation(f.db, { swarmId: f.swarmId, a: "Ann", b: "Cam" }).thread, null);
  assert.throws(
    () => sendMessage(f.db, { swarmId: f.swarmId, from: "Ann", to: "Ann", text: "Self", now: T0 }),
    /other than yourself/,
  );
  assert.throws(
    () => sendMessage(f.db, { swarmId: f.swarmId, from: "Ann", to: "Main", text: "No", now: T0 }),
    /recipient/,
  );
});

test("User receives messages and long text attachments; admission fence preserves shutdown semantics", (t) => {
  const f = workFixture(t);
  const sent = sendMessage(f.db, { swarmId: f.swarmId, from: "Ann", to: "User", text: "Please decide", now: T0 });
  assert.equal(markUserRead(f.db, f.swarmId, [sent.id], T0).updated, 1);
  const user = sendMessage(f.db, { swarmId: f.swarmId, from: "User", to: "Ann", text: "Long ".repeat(1000), now: T0 });
  assert.match(user.text, /full text:/);
  endRun(f.db, f.swarmId, process.pid, "stopped", T0, 1);
  const late = sendMessage(f.db, { swarmId: f.swarmId, from: "User", to: "Ann", text: "Late", now: T0 });
  assert.equal(getMessages(f.db, [late.id])[0]?.recipients[0]?.status, "undeliverable");
});

test("Main feedback is copied into separate private conversations", (t) => {
  const f = workFixture(t);
  sendMainFeedback(f.db, f.swarmId, "Check updated requirements", T0);
  const rows = f.db.sql.prepare("SELECT thread_id, COUNT(*) AS n FROM thread_members GROUP BY thread_id").all();
  assert.ok(rows.length >= 4);
  assert.ok(rows.every((row) => row.n === 2));
});
