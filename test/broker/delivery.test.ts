import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { MessageView, ParticipantStatus, RecipientStatus } from "../../src/api-types.js";
import type { DeliveryOutcome, PromptPayload } from "../../src/agents/supervisor.js";
import { markDelivered } from "../../src/broker/delivery-state.js";
import { DeliveryLoop, type DeliveryTarget } from "../../src/broker/delivery.js";
import { sendMessage } from "../../src/broker/messages.js";
import { createPost } from "../../src/broker/wall.js";
import { DELIVERY_POLL_MS } from "../../src/constants.js";
import { getMessages } from "../../src/store/message-queries.js";
import { FakeClock } from "../agents/fake-clock.js";
import { createTempDb, seedSwarm, T0, type TempDb } from "../helpers/temp-db.js";

class FakeTarget implements DeliveryTarget {
  status: ParticipantStatus = "idle";
  prompts: PromptPayload[] = [];
  answer: DeliveryOutcome | null = { accepted: true };
  #held: ((outcome: DeliveryOutcome) => void)[] = [];

  deliver(prompt: PromptPayload): Promise<DeliveryOutcome> {
    this.prompts.push(prompt);
    const answer = this.answer;
    if (answer) return Promise.resolve(answer);
    return new Promise((resolve) => this.#held.push(resolve));
  }

  release(): void {
    for (const resolve of this.#held.splice(0)) resolve({ accepted: true });
  }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

let temp: TempDb;
let clock: FakeClock;
let swarmId: number;
let maria: FakeTarget;
let john: FakeTarget;
let loop: DeliveryLoop;
let userMessages: MessageView[];

function statusOf(messageId: number, name: string): RecipientStatus | undefined {
  return getMessages(temp.db, [messageId])[0]?.recipients.find((r) => r.name === name)?.status;
}

function send(from: string, to: string[], text: string): number {
  return sendMessage(temp.db, swarmId, from, to, text, clock.now()).id;
}

beforeEach(() => {
  temp = createTempDb();
  clock = new FakeClock(T0);
  swarmId = seedSwarm(temp.db, { agents: ["Maria", "John"] }).id;
  maria = new FakeTarget();
  john = new FakeTarget();
  userMessages = [];
  loop = new DeliveryLoop({
    db: temp.db,
    swarmId,
    agents: new Map([
      ["Maria", maria],
      ["John", john],
    ]),
    clock,
    onUserMessage: (message) => userMessages.push(message),
  });
});

afterEach(() => {
  loop.stop();
  temp.cleanup();
});

describe("DeliveryLoop", () => {
  it("routes rejected delivery and accepted-prompt DB failures to onError, once", async () => {
    for (const reject of [true, false]) {
      const failure = new Error("delivery persistence failure");
      const errors: unknown[] = [];
      const target: DeliveryTarget = {
        status: "idle",
        deliver: async () => {
          if (reject) throw failure;
          return { accepted: true };
        },
      };
      const tested = new DeliveryLoop({
        db: temp.db,
        swarmId,
        clock,
        agents: new Map([["Maria", target]]),
        onError: (error) => errors.push(error),
      });
      send("User", ["Maria"], "delivery failure");
      tested.start();
      const original = temp.db.write;
      if (!reject)
        temp.db.write = () => {
          throw failure;
        };
      try {
        clock.advance(0);
        await flush();
        clock.advance(DELIVERY_POLL_MS * 5);
        await flush();
        assert.deepEqual(errors, [failure]);
      } finally {
        temp.db.write = original;
        tested.stop();
      }
    }
  });

  it("keeps unread recovery under the same in-flight guard as normal delivery", async () => {
    const id = send("User", ["Maria"], "queued");
    markDelivered(temp.db, swarmId, "Maria", [id], clock.now());
    let recoveries = 0;
    const target: DeliveryTarget = {
      status: "idle",
      deliver: () => {
        throw new Error("must recover instead");
      },
      recoverUnread: (prompt) => {
        recoveries++;
        return maria.deliver(prompt);
      },
    };
    maria.answer = null;
    const tested = new DeliveryLoop({ db: temp.db, swarmId, clock, agents: new Map([["Maria", target]]) });
    tested.start();
    clock.advance(DELIVERY_POLL_MS * 5);
    assert.equal(recoveries, 1);
    assert.deepEqual(maria.prompts[0].messageIds, [id]);
    tested.stop();
    maria.release();
    await flush();
  });
  it("wakes on a local write without waiting for the poll and marks the message delivered", async () => {
    loop.start();
    const id = send("User", ["Maria"], "hello");
    clock.advance(0);
    await flush();
    assert.equal(maria.prompts.length, 1);
    assert.match(maria.prompts[0].text, new RegExp(`\\[swarm message #${id}\\] thread #\\d+ · from User · to: You`));
    assert.deepEqual(maria.prompts[0].messageIds, [id]);
    assert.equal(statusOf(id, "Maria"), "delivered");
  });

  it("delivers several queued messages in one prompt, each with its own header", async () => {
    const first = send("User", ["Maria"], "one");
    const second = send("John", ["Maria"], "two");
    loop.start();
    clock.advance(0);
    await flush();
    assert.equal(maria.prompts.length, 1);
    assert.deepEqual(maria.prompts[0].messageIds, [first, second]);
    assert.equal(maria.prompts[0].text.match(/\[swarm message #/g)?.length, 2);
  });

  it("keeps messages pending for pending, starting and crashed agents, and delivers once they run", async () => {
    loop.start();
    const id = send("User", ["Maria"], "later");
    for (const status of ["pending", "starting", "crashed"] as const) {
      maria.status = status;
      clock.advance(DELIVERY_POLL_MS);
      await flush();
      assert.equal(maria.prompts.length, 0, status);
      assert.equal(statusOf(id, "Maria"), "pending");
    }
    maria.status = "working";
    clock.advance(DELIVERY_POLL_MS);
    await flush();
    assert.equal(maria.prompts.length, 1);
    assert.equal(statusOf(id, "Maria"), "delivered");
  });

  it("sends one prompt per agent at a time and keeps a rejected message pending", async () => {
    maria.answer = null;
    loop.start();
    const id = send("User", ["Maria"], "slow");
    clock.advance(DELIVERY_POLL_MS * 3);
    await flush();
    assert.equal(maria.prompts.length, 1, "no second prompt while the first is unanswered");
    maria.release();
    await flush();
    assert.equal(statusOf(id, "Maria"), "delivered");

    const rejected = send("User", ["John"], "nope");
    john.answer = { accepted: false, error: "John is starting." };
    clock.advance(0);
    await flush();
    assert.equal(statusOf(rejected, "John"), "pending");
    john.answer = { accepted: true };
    clock.advance(DELIVERY_POLL_MS);
    await flush();
    assert.equal(statusOf(rejected, "John"), "delivered");
  });

  it("never wakes anyone for wall posts", async () => {
    loop.start();
    createPost(temp.db, swarmId, "User", { title: "Plan", text: "read me" }, clock.now());
    clock.advance(DELIVERY_POLL_MS * 2);
    await flush();
    assert.equal(maria.prompts.length + john.prompts.length, 0);
  });

  it("collects pending messages, plus delivered-not-read ones for a revive", () => {
    const delivered = send("User", ["Maria"], "delivered");
    markDelivered(temp.db, swarmId, "Maria", [delivered], clock.now());
    const pending = send("John", ["Maria"], "pending");
    assert.deepEqual(loop.collect("Maria", false).messageIds, [pending]);
    const revive = loop.collect("Maria", true);
    assert.deepEqual(revive.messageIds, [delivered, pending]);
    assert.match(revive.text, /"delivered"[\s\S]*"pending"/);
    assert.deepEqual(loop.collect("John", true), { text: "", messageIds: [] });
  });

  it("reports only new messages for User, once each", async () => {
    send("Maria", ["User"], "before the run");
    loop.start();
    const id = send("John", ["User", "Maria"], "for you");
    clock.advance(DELIVERY_POLL_MS * 2);
    await flush();
    assert.deepEqual(
      userMessages.map((message) => message.id),
      [id],
    );
  });

  it("does nothing after stop", async () => {
    loop.start();
    loop.stop();
    const id = send("User", ["Maria"], "too late");
    clock.advance(DELIVERY_POLL_MS * 2);
    await flush();
    assert.equal(maria.prompts.length, 0);
    assert.equal(statusOf(id, "Maria"), "pending");
  });
});
