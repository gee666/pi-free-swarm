import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { reviewTask } from "../../src/broker/review.js";
import { startTask } from "../../src/broker/task-transitions.js";
import { reviewSessionFile } from "../../src/broker/task-review.js";
import { getTask, taskTimeline } from "../../src/store/tasks.js";
import { isPidAlive } from "../../src/store/locks.js";
import { REVIEW_OUTPUT_MAX, REVIEW_TIMEOUT_MS } from "../../src/constants.js";
import { createFakePiRun, fakePiCommandEnv, waitFor, type FakePiScenario } from "../fixtures/fake-pi/harness.js";
import { workFixture } from "../helpers/work-graph.js";
import { FakeClock } from "../agents/fake-clock.js";

const model = { provider: "test-provider", modelId: "caller-model", thinkingLevel: "high" };
function fixture(t: TestContext, scenario: FakePiScenario) {
  const f = workFixture(t);
  const fake = createFakePiRun(scenario);
  const env = { ...fakePiCommandEnv(), ...fake.env, PI_SWARM_REVIEW_SENTINEL: "must not leak" };
  const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fake.cleanup();
  });
  const task = f.task(f.criterion.id, [], true);
  startTask(f.db, { ...f.input(), id: task.id });
  const input = { ...f.input(), run: 1, id: task.id, context: "Changed src/feature.ts; run npm test." };
  return { ...f, fake, task, newTask: f.task, input };
}

test(
  "clean reviewer inherits caller model/thinking, project cwd and explicit session, recording native usage",
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t, {
      runs: [
        [
          {
            type: "reply",
            text: "Tests passed.\nVERDICT: accept",
            usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 4, cost: 0.25 },
          },
          { type: "compaction", usage: { input: 8, output: 2, cost: 0.01 } },
        ],
      ],
    });
    const output = await reviewTask(f.db, f.input, { model });
    assert.match(output, /\[accepted\]/);
    assert.equal(getTask(f.db, f.swarmId, f.task.id)?.acceptedBy, "Ann review");
    const spawn = f.fake.log().find((record) => record.fake === "spawn");
    const argv = spawn?.argv;
    assert.ok(Array.isArray(argv));
    for (const flag of ["--no-extensions", "--no-mcp", "--print"]) assert.ok(argv.includes(flag));
    for (const flag of ["--swarm", "-e", "--extension", "--continue"]) assert.ok(!argv.includes(flag));
    assert.equal(argv[argv.indexOf("--mode") + 1], "json");
    assert.equal(argv[argv.indexOf("--model") + 1], "test-provider/caller-model");
    assert.equal(argv[argv.indexOf("--thinking") + 1], "high");
    const sessionFile = reviewSessionFile(f.db, f.swarmId, f.task.id);
    assert.equal(argv[argv.indexOf("--session") + 1], sessionFile);
    assert.ok(
      sessionFile.endsWith(path.join("sessions", String(f.swarmId), "reviews", `task-${f.task.id}`, "session.jsonl")),
    );
    const request = f.fake.log().find((record) => record.fake === "review");
    assert.deepEqual(request?.swarmEnv, []);
    assert.equal(request?.cwd, f.cwd);
    assert.match(String(request?.prompt), /Implement and test the feature/);
    assert.match(String(request?.prompt), /The feature works/);
    const usage = f.db.sql
      .prepare("SELECT agent, run, kind, input, output, cache_read, cache_write, cost, model FROM usage ORDER BY id")
      .all();
    assert.deepEqual(
      usage.map((row) => row.agent),
      ["Ann", "Ann"],
    );
    assert.equal(usage[0]?.run, 1);
    assert.equal(usage[0]?.input, 100);
    assert.equal(usage[0]?.output, 20);
    assert.equal(usage[0]?.cache_read, 30);
    assert.equal(usage[0]?.cache_write, 4);
    assert.equal(usage[0]?.cost, 0.25);
    assert.equal(usage[0]?.model, "caller-model");
    assert.equal(usage[1]?.kind, "compaction");
  },
);

test(
  "changes returns findings and resume preserves the task session; another task starts clean",
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t, {
      spawns: [
        { runs: [[{ type: "reply", text: "VERDICT: changes Add regression coverage." }]] },
        { runs: [[{ type: "reply", text: "VERDICT: accept" }]] },
      ],
    });
    const first = await reviewTask(f.db, f.input, { model });
    assert.match(first, /in_progress.*\nVERDICT: changes Add regression coverage/);
    const file = reviewSessionFile(f.db, f.swarmId, f.task.id);
    const firstSession = readFileSync(file, "utf8");
    const resumed = await reviewTask(
      f.db,
      { ...f.input, context: "Added regression test; npm test passes.", resume: true },
      { model },
    );
    assert.match(resumed, /accepted/);
    const secondSession = readFileSync(file, "utf8");
    assert.ok(secondSession.startsWith(firstSession));
    assert.equal((secondSession.match(/"type":"session"/g) ?? []).length, 1);
    assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM usage WHERE agent = 'Ann'").get()?.n, 2);
    const task = f.newTask(f.criterion.id, [], true);
    startTask(f.db, { ...f.input, id: task.id });
    await reviewTask(f.db, { ...f.input, id: task.id }, { model });
    const newFile = reviewSessionFile(f.db, f.swarmId, task.id);
    assert.notEqual(newFile, file);
    assert.ok(!readFileSync(newFile, "utf8").includes("Add regression coverage"));
  },
);

test(
  "unparsable output requests changes and long findings are bounded with a full-text file",
  { timeout: 15000 },
  async (t) => {
    const text = "Concrete finding. ".repeat(REVIEW_OUTPUT_MAX);
    const f = fixture(t, { runs: [[{ type: "reply", text }]] });
    const output = await reviewTask(f.db, f.input, { model });
    assert.match(output, /in_progress/);
    assert.match(output, /Unparsable review verdict/);
    const file = /Full review: (.+)$/.exec(output)?.[1];
    assert.ok(file);
    assert.equal(readFileSync(file, "utf8"), `Unparsable review verdict.\n${text}`);
    assert.ok(output.length < REVIEW_OUTPUT_MAX + 1000);
    assert.equal(taskTimeline(f.db, f.task.id).at(-1)?.kind, "changes_requested");
  },
);

test("timeout kills a stubborn reviewer and its children and restores in_progress", { timeout: 15000 }, async (t) => {
  const f = fixture(t, {
    ignoreSigterm: true,
    runs: [[{ type: "grandchild", ignoreSigterm: true }, { type: "silence" }]],
  });
  const clock = new FakeClock(f.input.now);
  const pending = reviewTask(f.db, f.input, { model, clock });
  await waitFor(() => f.fake.log().some((record) => record.fake === "grandchild"), "reviewer grandchild");
  assert.equal(getTask(f.db, f.swarmId, f.task.id)?.status, "review");
  assert.equal(clock.nextDelay(), REVIEW_TIMEOUT_MS);
  clock.advance(REVIEW_TIMEOUT_MS);
  const output = await pending;
  assert.match(output, /Review timed out after 30 minutes/);
  assert.equal(getTask(f.db, f.swarmId, f.task.id)?.status, "in_progress");
  assert.equal(
    f.db.sql.prepare("SELECT reviewer_pid FROM task_reviews WHERE task_id = ?").get(f.task.id)?.reviewer_pid,
    null,
  );
  const pid = f.fake.log().find((record) => record.fake === "spawn")?.pid;
  assert.equal(typeof pid, "number");
  if (typeof pid === "number") assert.throws(() => process.kill(pid, 0), /ESRCH/);
  const child = f.fake.log().find((record) => record.fake === "grandchild")?.pid;
  assert.equal(typeof child, "number");
  if (typeof child === "number") await waitFor(() => !isPidAlive(child), "reviewer child killed");
  assert.equal(clock.pending, 0);
});

test("process failure and cancellation return a clear error and restore the task", { timeout: 15000 }, async (t) => {
  const f = fixture(t, { runs: [[{ type: "exit", code: 3, stderr: "Provider rejected credentials" }]] });
  const output = await reviewTask(f.db, f.input, { model });
  assert.match(output, /Reviewer exited \(3\).*Provider rejected credentials/);
  assert.equal(getTask(f.db, f.swarmId, f.task.id)?.status, "in_progress");
  const controller = new AbortController();
  controller.abort();
  const aborted = await reviewTask(f.db, f.input, { model, signal: controller.signal });
  assert.match(aborted, /Review cancelled/);
  assert.equal(getTask(f.db, f.swarmId, f.task.id)?.status, "in_progress");
});
