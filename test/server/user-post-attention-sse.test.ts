import assert from "node:assert/strict";
import { test } from "node:test";
import { setUserPostSubscription } from "../../src/broker/user-post-subscription.js";
import { createPost } from "../../src/broker/wall.js";
import { markSwarmRunning } from "../../src/broker/swarms.js";
import { EVENTS_TAIL_MS } from "../../src/constants.js";
import { listEventsAfter, latestEventId } from "../../src/store/events.js";
import { FakeClock } from "../agents/fake-clock.js";
import { seedSwarm, T0 } from "../helpers/temp-db.js";
import { openSse, startTestBoard } from "./helpers.js";

test(
  "User post-attention events reach only their selected swarm, never the global picker",
  { timeout: 10_000 },
  async (t) => {
    const clock = new FakeClock(T0);
    const board = await startTestBoard({ clock });
    t.after(() => board.close());
    const { db } = board.temp;
    const mine = seedSwarm(db, { agents: ["Maria"] });
    const other = seedSwarm(db, { agents: ["John"], name: "other" });
    const post = createPost(db, mine.id, "Maria", { title: "Mine", text: "body" }, T0);
    const outside = createPost(db, other.id, "John", { title: "Other", text: "private other body" }, T0);
    const selected = await openSse(`${board.base}/events?swarm=${mine.id}`);
    const picker = await openSse(`${board.base}/events`);
    t.after(() => {
      selected.close();
      picker.close();
    });
    const before = latestEventId(db);
    const followed = setUserPostSubscription(db, mine.id, post.id, true, T0);
    setUserPostSubscription(db, other.id, outside.id, true, T0);
    const left = setUserPostSubscription(db, mine.id, post.id, false, T0);
    const recorded = listEventsAfter(db, before, 100).filter((event) => event.type === "user.post.updated");
    assert.equal(recorded.length, 3, "the decoder recognizes every durable attention event");
    assert.deepEqual(
      recorded.map((event) => event.payload),
      [
        followed,
        {
          postId: outside.id,
          userSubscribed: true,
          userUnreadComments: 0,
          userUnread: { messages: 0, comments: 0 },
        },
        left,
      ],
    );

    // A later public marker makes each assertion cover all preceding private frames.
    markSwarmRunning(db, mine.id, process.pid, T0 + 1);
    clock.advance(EVENTS_TAIL_MS);
    const marker = ({ event }: (typeof selected.frames)[number]) =>
      event?.type === "swarm.updated" && event.swarmId === mine.id && event.payload.swarm.status === "running";
    await selected.next(marker);
    await picker.next(marker);
    const delivered = selected.frames.flatMap(({ event }) =>
      event?.type === "user.post.updated" ? [event.payload] : [],
    );
    assert.deepEqual(delivered, [followed, left]);
    assert.ok(selected.frames.every(({ event }) => event === null || event.swarmId === mine.id));
    assert.ok(
      picker.frames.every(({ event }) => event === null || event.type === "swarm.updated"),
      "global discovery cannot disclose User post attention or other private events",
    );
  },
);
