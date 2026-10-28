import assert from "node:assert/strict";
import { requestReview, reviewResult } from "./review-helpers.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
  CreatePostResponse,
  PostDetailResponse,
  PostLinksResponse,
  PostListResponse,
  PostsSearchResponse,
  SearchConfigResponse,
  SendMessageResponse,
  SkillResponse,
  SkillsResponse,
} from "../../src/api-types.js";
import { addComment } from "../../src/broker/wall.js";
import { voteCriterion } from "../../src/broker/votes.js";
import { getJson, isType, openSse, postJson } from "./helpers.js";
import { action, createHttpCriterion, createHttpTask, workBoard, type WorkBoard } from "./work-helpers.js";

let board: WorkBoard;
beforeEach(async () => {
  board = await workBoard();
});
afterEach(() => board.close());
function skillFolder(name: string, description = "Automate checks") {
  const folder = path.join(board.temp.db.dataDir, "skills", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\nRun the checks.\n`,
  );
  return folder;
}

describe("post links and search", () => {
  it("creates links atomically, enriches detail and searches comments with SQL filters", async () => {
    const criterion = await createHttpCriterion(board);
    const task = await createHttpTask(board, criterion.id);
    const created = await postJson<CreatePostResponse>(board.url("/posts"), {
      title: "Implementation",
      text: "HTTP details",
      taskIds: [task.id],
      criterionIds: [criterion.id],
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.links.length, 2);
    assert.ok(created.body.links.some((link) => link.targetKind === "task" && link.title === task.title));
    const postId = created.body.post.id;
    addComment(board.temp.db, board.swarm.id, "Maria", postId, "Zebrafish evidence", Date.now());
    const result = await getJson<PostsSearchResponse>(
      board.url(`/posts?query=Zebrafish&author=User&taskId=${task.id}&criterionId=${criterion.id}`),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.items[0].id, postId);
    assert.equal(result.body.items[0].commentCount, 1);
    assert.deepEqual(result.body.posts, result.body.items);
    assert.equal(result.body.mode, "bm25");
    const detail = await getJson<PostDetailResponse>(board.url(`/posts/${postId}`));
    assert.equal(detail.body.links.length, 2);
    assert.equal(detail.body.comments[0].author, "Maria");
    const taskDetail = await getJson<{ linkedPosts: { title: string; commentCount: number }[] }>(
      board.url(`/tasks/${task.id}`),
    );
    assert.deepEqual(
      taskDetail.body.linkedPosts.map((post) => [post.title, post.commentCount]),
      [["Implementation", 1]],
    );
    const unlinked = await postJson<PostLinksResponse>(board.url(`/posts/${postId}/unlink`), { taskIds: [task.id] });
    assert.equal(unlinked.status, 200);
    assert.equal(unlinked.body.links.length, 1);
    assert.equal((await postJson(board.url(`/posts/${postId}/link`), { taskIds: [task.id] })).status, 200);
    assert.equal((await postJson(board.url(`/posts/${postId}/link`), { taskIds: [task.id] })).status, 200);
    const listing = await getJson<PostListResponse>(board.url("/posts?count=1&offset=0"));
    assert.equal(listing.body.posts[0].id, postId);
    const rollback = await postJson(board.url("/posts"), { title: "Rollback", text: "No orphan", taskIds: [999999] });
    assert.equal(rollback.status, 404);
    assert.equal((await getJson<PostListResponse>(board.url("/posts"))).body.total, 1);
    assert.equal((await postJson(board.url(`/posts/${postId}/link`), { taskIds: ["bad"] })).status, 400);
  });

  it("projects linked task lifecycle and waiting statuses and current criterion statuses", async () => {
    const criterion = await createHttpCriterion(board);
    const unlinked = await createHttpCriterion(board, { title: "No tasks" });
    const dependency = await createHttpTask(board, criterion.id, { claim: true });
    const task = await createHttpTask(board, criterion.id, { dependsOn: [dependency.id] });
    const created = await postJson<CreatePostResponse>(board.url("/posts"), {
      title: "Status links",
      text: "Track work",
      taskIds: [task.id],
      criterionIds: [criterion.id, unlinked.id],
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.links.find((link) => link.targetKind === "task")?.status, "waiting");
    assert.equal(
      created.body.links.find((link) => link.targetId === criterion.id && link.targetKind === "criterion")?.status,
      "incomplete",
    );
    assert.equal(
      created.body.links.find((link) => link.targetId === unlinked.id && link.targetKind === "criterion")?.status,
      "unlinked",
    );
    const detailUrl = board.url(`/posts/${created.body.post.id}`);
    const taskStatus = async () =>
      (await getJson<PostDetailResponse>(detailUrl)).body.links.find((link) => link.targetKind === "task")?.status;
    await action(board, dependency.id, "handoff", { to: "Maria" });
    await action(board, dependency.id, "start");
    requestReview(board, dependency.id, "Dependency verified");
    reviewResult(board, dependency.id, "accept", "Passed");
    assert.equal(await taskStatus(), "new");
    await action(board, task.id, "claim");
    assert.equal(await taskStatus(), "claimed");
    await action(board, task.id, "handoff", { to: "Maria" });
    await action(board, task.id, "start");
    assert.equal(await taskStatus(), "in_progress");
    requestReview(board, task.id, "Work verified");
    assert.equal(await taskStatus(), "review");
    reviewResult(board, task.id, "accept", "Passed");
    assert.equal(await taskStatus(), "accepted");
    voteCriterion(board.temp.db, {
      swarmId: board.swarm.id,
      actor: "Maria",
      now: Date.now(),
      criterionId: criterion.id,
      verdict: "covered",
      reason: "Owner verified",
    });
    assert.equal(
      (
        await postJson(board.url(`/criteria/${criterion.id}/vote`), {
          verdict: "covered",
          reason: "Independent verified",
        })
      ).status,
      200,
    );
    const linked = await postJson<PostLinksResponse>(board.url(`/posts/${created.body.post.id}/link`), {
      criterionIds: [criterion.id],
    });
    assert.equal(
      linked.body.links.find((link) => link.targetId === criterion.id && link.targetKind === "criterion")?.status,
      "satisfied",
    );
    const removed = await postJson<PostLinksResponse>(board.url(`/posts/${created.body.post.id}/unlink`), {
      criterionIds: [unlinked.id],
    });
    assert.equal(removed.body.links.length, 2);
    assert.ok(removed.body.links.every((link) => link.status === "satisfied" || link.status === "accepted"));
    assert.equal(
      (
        await postJson(board.url(`/criteria/${criterion.id}/block`), {
          reason: "Lost access",
          missing: "Credentials",
          attempted: "Checked environment",
          unblock: "Restore access",
        })
      ).status,
      200,
    );
    voteCriterion(board.temp.db, {
      swarmId: board.swarm.id,
      actor: "Maria",
      now: Date.now(),
      criterionId: criterion.id,
      verdict: "blocked",
      reason: "Owner agrees",
    });
    assert.equal(
      (
        await postJson(board.url(`/criteria/${criterion.id}/vote`), {
          verdict: "blocked",
          reason: "Independent agrees",
        })
      ).status,
      200,
    );
    const blocked = await getJson<PostDetailResponse>(detailUrl);
    assert.equal(blocked.body.links.find((link) => link.targetKind === "criterion")?.status, "blocked");
  });

  it("does not expose legacy routes or legacy fields", async () => {
    for (const route of [
      "/acceptance",
      "/acceptance/history",
      "/acceptance/archived",
      "/wall-coverage",
      "/read-marks",
      "/posts/1/claims",
      "/posts/1/contract",
    ]) {
      assert.equal((await getJson(board.url(route))).status, 404, route);
      assert.equal((await postJson(board.url(route), {})).status, 404, route);
    }
    assert.equal((await postJson(board.url("/threads/1/reply"), { text: "Legacy" })).status, 404);
    const detail = await getJson<Record<string, unknown>>(board.url(""));
    assert.ok(!("acceptance" in detail.body));
    const post = await postJson<CreatePostResponse>(board.url("/posts"), { title: "Clean", text: "No contracts" });
    assert.ok(!("claims" in post.body.post));
    assert.ok(!("contract" in post.body.post));
  });
});

describe("single-recipient messages", () => {
  it("continues the same conversation, rejects arrays, and accepts long text", async () => {
    const first = await postJson<SendMessageResponse>(board.url("/messages"), { to: "Maria", text: "Status?" });
    assert.equal(first.status, 201);
    assert.equal(first.body.message.sender, "User");
    assert.equal(first.body.message.recipients.length, 1);
    const second = await postJson<SendMessageResponse>(board.url("/messages"), {
      to: "maria",
      text: "Evidence\n".repeat(20_000),
    });
    assert.equal(second.status, 201);
    assert.equal(second.body.message.threadId, first.body.message.threadId);
    assert.match(second.body.message.text, /\.pi\/swarm\/attachments/);
    assert.equal((await postJson(board.url("/messages"), { to: ["Maria", "John"], text: "No broadcast" })).status, 400);
    assert.equal((await postJson(board.url("/messages"), { to: ["Maria"], text: "String only" })).status, 400);
    assert.equal((await postJson(board.url("/messages"), { to: "User", text: "Not an agent" })).status, 400);
  });
});

describe("skills and search configuration", () => {
  it("syncs skills, pages search, exposes detail and reports invalid catalogue entries", async () => {
    const folder = skillFolder("checks", "Build and test HTTP");
    skillFolder("review", "Review HTTP");
    const invalid = path.join(board.temp.db.dataDir, "skills", "invalid");
    mkdirSync(invalid);
    writeFileSync(path.join(invalid, "SKILL.md"), "Missing frontmatter");
    const first = await getJson<SkillsResponse>(board.url("/skills?query=HTTP&limit=1"));
    assert.equal(first.status, 200);
    assert.equal(first.body.mode, "bm25");
    assert.ok(first.body.nextCursor);
    const second = await getJson<SkillsResponse>(
      board.url(`/skills?query=HTTP&limit=1&cursor=${first.body.nextCursor}`),
    );
    assert.notEqual(second.body.items[0].name, first.body.items[0].name);
    const detail = await getJson<SkillResponse>(board.url("/skills/checks"));
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.files, ["SKILL.md"]);
    assert.match(detail.body.content ?? "", /Run the checks/);
    assert.equal(detail.body.path, ".pi/swarm/skills/checks");
    writeFileSync(path.join(folder, "script.sh"), "echo checked\n");
    const updated = await getJson<SkillResponse>(board.url("/skills/checks"));
    assert.equal(updated.body.revision, detail.body.revision + 1);
    const bad = await getJson<SkillResponse>(board.url("/skills/invalid"));
    assert.ok(bad.body.error);
    assert.equal((await getJson(board.url("/skills/missing"))).status, 404);
    rmSync(folder, { recursive: true });
    assert.equal((await getJson(board.url("/skills/checks"))).status, 404);
  });

  it("returns ranking model labels without URLs or secrets", async () => {
    const defaults = await getJson<SearchConfigResponse>(board.url("/search-config"));
    assert.deepEqual(defaults.body, { ranking: "bm25", embedding: "off", reranker: "off", maxResults: 20 });
    const settings = path.join(board.temp.db.dataDir, "settings.json");
    writeFileSync(settings, JSON.stringify({ helperModel: "provider/model/off", search: { maxResults: 12 } }));
    const helper = await getJson<SearchConfigResponse>(board.url("/search-config"));
    assert.equal(helper.body.reranker, "helper model provider/model/off");
    assert.equal(helper.body.maxResults, 12);
    writeFileSync(
      settings,
      JSON.stringify({
        helperModel: "provider/model/off",
        search: {
          embedding: { url: "https://example.com", model: "embed", apiKeyEnv: "PRIVATE_KEY" },
          jev: { url: "https://example.com", model: "rank", apiKeyEnv: "PRIVATE_KEY" },
        },
      }),
    );
    const dedicated = await getJson<SearchConfigResponse>(board.url("/search-config"));
    assert.deepEqual(dedicated.body, { ranking: "bm25", embedding: "embed", reranker: "JEV rank", maxResults: 20 });
    assert.ok(!JSON.stringify(dedicated.body).includes("PRIVATE_KEY"));
    assert.equal((await getJson(`${board.base}/api/swarms/99999/search-config`)).status, 404);
  });
});

describe("work SSE", () => {
  it("streams typed graph and skill changes and replays them on reconnect", async () => {
    const stream = await openSse(`${board.base}/events?swarm=${board.swarm.id}`);
    try {
      const criterion = await createHttpCriterion(board);
      const task = await createHttpTask(board, criterion.id);
      const post = await postJson<CreatePostResponse>(board.url("/posts"), {
        title: "Discussion",
        text: "Linked",
        taskIds: [task.id],
      });
      for (const [type, id] of [
        ["criterion.changed", criterion.id],
        ["task.changed", task.id],
        ["project.changed", board.swarm.id],
        ["post.links.changed", post.body.post.id],
      ]) {
        const frame = await stream.next(
          (frame) => frame.event?.type === type && "id" in frame.event.payload && frame.event.payload.id === id,
        );
        assert.equal(frame.event?.swarmId, board.swarm.id);
        assert.ok(frame.id);
      }
      skillFolder("live");
      await getJson(board.url("/skills"));
      const changed = await stream.next(isType("skill.changed"));
      assert.deepEqual(changed.event?.payload, { id: "live" });
      const criterionFrame = await stream.next(isType("criterion.changed"));
      const replay = await openSse(`${board.base}/events?swarm=${board.swarm.id}`, {
        "Last-Event-ID": criterionFrame.id ?? "0",
      });
      try {
        assert.equal((await replay.next(isType("skill.changed"))).event?.type, "skill.changed");
      } finally {
        replay.close();
      }
    } finally {
      stream.close();
    }
  });
});
