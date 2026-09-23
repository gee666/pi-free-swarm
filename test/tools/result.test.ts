import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { WALL_DIGEST_MAX_POSTS } from "../../src/constants.js";
import { sendMessage } from "../../src/broker/messages.js";
import { endRun } from "../../src/broker/swarms.js";
import { addComment, createPost } from "../../src/broker/wall.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { buildRunResultText } from "../../src/tools/result.js";
import { createTempDb, seedSwarm, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
const END = T0 + 23 * 60_000;
const BOARD = "http://127.0.0.1:3010";

function outcomeOf(swarmId: number, end: "finished" | "stopped" | "interrupted") {
  const swarm = getSwarm(db, swarmId, END);
  assert.ok(swarm);
  return { swarm, run: 1, end };
}

describe("buildRunResultText", () => {
  it("formats a finished swarm per plan §6.1", () => {
    const swarm = seedSwarm(db, { name: "auth-refactor" });
    createPost(db, swarm.id, "Maria", { title: "Kickoff", text: "I take backend API routes." }, T0 + 1_000);
    const plan = createPost(db, swarm.id, "John", { title: "UI", text: "UI states are mine." }, T0 + 2_000);
    addComment(db, swarm.id, "Maria", plan.id, "ok", T0 + 3_000);
    sendMessage(db, swarm.id, "Maria", ["User"], "Which auth provider?", T0 + 4_000);
    sendMessage(db, swarm.id, "John", ["User"], "Done with UI.", T0 + 5_000);
    endRun(db, swarm.id, process.pid, "finished", END);

    const text = buildRunResultText(db, outcomeOf(swarm.id, "finished"), BOARD, END);
    assert.equal(
      text,
      [
        `Swarm "auth-refactor" (#${swarm.id}) finished. Run 1. 3 agents, 23m, $0.00, 0 tokens.`,
        `Board: ${BOARD}/s/${swarm.id}`,
        "",
        "Wall digest (all posts, oldest first):",
        `#1 Maria: "Kickoff" — I take backend API routes. (0 comments)`,
        `#2 John: "UI" — UI states are mine. (1 comment)`,
        "",
        "Messages to User: 2, 2 unread (see board).",
        "",
        "Next: review the actual work (git status/diff, files mentioned on the wall, run tests),",
        "then summarise to the user. If the work is incomplete or wrong, call",
        `resume_swarm(${swarm.id}, "<what is wrong and what to do>").`,
      ].join("\n"),
    );
  });

  it(`caps the digest at the newest ${WALL_DIGEST_MAX_POSTS} posts, oldest first`, () => {
    const swarm = seedSwarm(db, { name: "big" });
    const total = WALL_DIGEST_MAX_POSTS + 12;
    for (let index = 1; index <= total; index++) {
      createPost(db, swarm.id, "Liam", { title: `P${index}`, text: "status" }, T0 + index);
    }
    endRun(db, swarm.id, process.pid, "finished", END);
    const lines = buildRunResultText(db, outcomeOf(swarm.id, "finished"), BOARD, END).split("\n");
    const header = lines.findIndex((line) => line.startsWith("Wall digest"));
    assert.equal(
      lines[header],
      `Wall digest (newest ${WALL_DIGEST_MAX_POSTS} of ${total} posts, oldest first; older ones on the board):`,
    );
    const posts = lines.filter((line) => line.startsWith("#"));
    assert.equal(posts.length, WALL_DIGEST_MAX_POSTS);
    assert.match(posts[0], /"P13"/);
    assert.match(posts[posts.length - 1], new RegExp(`"P${total}"`));
  });

  it("explains stopped and interrupted runs, an empty wall and a missing board", () => {
    const swarm = seedSwarm(db, { name: "halted" });
    endRun(db, swarm.id, process.pid, "stopped", END);
    const stopped = buildRunResultText(db, outcomeOf(swarm.id, "stopped"), null, END);
    assert.match(stopped, /^Swarm "halted" \(#\d+\) was stopped \(tool aborted, all agents killed\)\. Run 1\./);
    assert.match(stopped, /\nBoard: not running\.\n/);
    assert.match(stopped, /\nWall: no posts\.\n/);
    assert.match(stopped, /\nMessages to User: none\.\n/);
    assert.match(stopped, /continue only if they want it, with resume_swarm\(\d+, /);
    const interrupted = buildRunResultText(db, outcomeOf(swarm.id, "interrupted"), BOARD, END);
    assert.match(interrupted, /was interrupted \(this pi process lost the swarm's run lock\)/);
  });
});
