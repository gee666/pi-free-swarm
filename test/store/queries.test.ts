import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { setAgentStatus } from "../../src/broker/agent-state.js";
import { systemNotice } from "../helpers/system-notice.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { getStats } from "../../src/store/stats-queries.js";
import { getParticipant, listParticipants } from "../../src/store/swarm-queries.js";
import { getPostDetail, listPosts } from "../../src/store/wall-queries.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;

describe("participants", () => {
  const swarm = seedSwarm(db);

  it("lists User first, then agents; Main and System never", () => {
    systemNotice(db, { swarmId: swarm.id, to: "John", text: "a", now: T0 });
    const [user, maria, john] = listParticipants(db, swarm.id);
    assert.deepEqual(user, { kind: "user", name: "User", unread: 0, joinedAt: null, lastActivityAt: null });
    assert.equal(maria.kind === "agent" && maria.launchOrder, 0);
    assert.equal(john.unread, 1);
    assert.equal(getParticipant(db, swarm.id, "main"), null);
    assert.equal(getParticipant(db, swarm.id, "JOHN")?.name, "John");
  });
});

describe("wall and statistics", () => {
  it("pages the wall and counts activity", () => {
    const swarm = seedSwarm(db);
    const post = createPost(db, swarm.id, "Maria", { title: "a", text: "x" }, T0);
    createPost(db, swarm.id, "John", { title: "b", text: "y" }, T0);
    addComment(db, swarm.id, "John", post.id, "c", T0);
    systemNotice(db, { swarmId: swarm.id, to: "Maria", text: "m", now: T0 });
    setAgentStatus(db, swarm.id, "John", "working", T0);

    const page = listPosts(db, swarm.id, { count: 1, offset: 1 });
    assert.deepEqual([page.total, page.posts[0].id, page.posts[0].commentCount], [2, post.id, 1]);
    assert.equal(getPostDetail(db, swarm.id + 100, post.id), null);

    const stats = getStats(db, swarm.id, T0 + 3_000);
    const john = stats?.agents.find((a) => a.name === "John");
    assert.deepEqual(john && [john.posts, john.comments, john.messagesSent, john.activeTimeMs, john.status], [
      1,
      1,
      0,
      3_000,
      "working",
    ]);
    assert.deepEqual(
      stats && [stats.totals.posts, stats.totals.comments, stats.totals.messages, stats.totals.wallTimeMs],
      [2, 1, 2, 3_000],
    );
    assert.deepEqual(
      stats?.agents.map((a) => a.name),
      ["Maria", "John", "Liam", "Watcher"],
    );
    assert.equal(getStats(db, 9999, T0), null);
  });
});
