import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { readBudget } from "../../src/store/budget.js";
import { inspectAcceptance, mutateAcceptance, recordRosterAcceptanceChange } from "../../src/broker/acceptance.js";
import { sendMessage } from "../../src/broker/messages.js";
import { readRunProgress } from "../../src/broker/run-progress.js";
import { createSwarm, endRun } from "../../src/broker/swarms.js";
import { createPost } from "../../src/broker/wall.js";
import { getSwarm } from "../../src/store/swarm-queries.js";
import { boundRunResult, buildRunResultText, type RunToolResult } from "../../src/tools/result.js";
import { createTempDb, T0 } from "../helpers/temp-db.js";

const temp = createTempDb();
after(() => temp.cleanup());
const { db } = temp;
const END = T0 + 23 * 60_000;
const BOARD = "http://127.0.0.1:3010";
const GOAL = "Build the thing. Requirements: docs/req.md";
const CRITERIA = ["The requested behavior works.", "Tests pass and documentation is updated."];
const AGENTS = ["Maria", "John", "Liam", "Olivia", "Emma"];

function fixture(name = "demo", agents: readonly string[] = AGENTS) {
  return createSwarm(db, {
    name,
    taskPrompt: GOAL,
    acceptanceCriteria: CRITERIA,
    agentNames: agents,
    runnerPid: process.pid,
    now: T0,
  });
}

function vote(swarmId: number, agent: string, verdict: "accepted" | "incomplete" | "blocked", reason: string) {
  mutateAcceptance(db, swarmId, agent, { action: "vote", verdict, reason }, T0);
}

function outcomeOf(swarmId: number, end: "finished" | "stopped" | "interrupted") {
  const swarm = getSwarm(db, swarmId, END);
  assert.ok(swarm);
  return { swarm, run: 1, end, acceptance: inspectAcceptance(db, swarmId, { includeExcludedVotes: true }) };
}

describe("buildRunResultText", () => {
  it("reports budget exhaustion honestly for graceful stops and explains cumulative resume", () => {
    const swarm = fixture("budget-summary");
    const text = buildRunResultText(
      db,
      {
        ...outcomeOf(swarm.id, "stopped"),
        stopReason: "budget-exhausted",
        budget: readBudget(db, swarm.id, { budgetTimeSeconds: 1, gracefulShutdownOnBudget: true }, END),
      },
      BOARD,
      END,
    );
    assert.match(text, /stopped on budget exhaustion/);
    assert.doesNotMatch(text, /tool aborted, all agents killed/);
    assert.match(text, /Stop reason: budget-exhausted/);
    assert.match(text, /Consumption is not reset/);
    assert.match(text, /after user agreement/);
    assert.match(text, /external effects are uncertain/);
    assert.match(text, /No completion verdict was finalized/);
  });
  it("renders the closure snapshot with every vote reason, including dissent", () => {
    const swarm = fixture();
    for (const agent of AGENTS.slice(0, 4)) vote(swarm.id, agent, "accepted", `${agent} checked the whole task.`);
    vote(swarm.id, "Emma", "blocked", "Owner approval is missing.\nDo not ship yet.");
    const outcome = outcomeOf(swarm.id, "finished");
    vote(swarm.id, "John", "incomplete", "Output changed; recheck requirements.");

    const text = buildRunResultText(db, outcome, BOARD, T0);
    assert.match(text, /Task verdict: accepted \(acceptance revision 5\)/);
    assert.match(text, /Accepted by agent votes, not independent verification/);
    assert.match(text, /Tally: 4 accepted, 0 incomplete, 1 blocked; 5\/5 agents voted\. Threshold: 4\/5/);
    for (const agent of AGENTS.slice(0, 4)) {
      assert.ok(text.includes(`- ${agent} (run 1): accepted. Reason: ${agent} checked the whole task.`));
    }
    assert.ok(text.includes("- Emma (run 1): blocked. Reason: Owner approval is missing.\nDo not ship yet."));
    assert.ok(!text.includes("Output changed"));
    const updated = buildRunResultText(db, outcomeOf(swarm.id, "finished"), BOARD, T0);
    assert.match(updated, /Task verdict: incomplete \(acceptance revision 6\)/);
    assert.match(updated, /John \(run 1\): incomplete\. Reason: Output changed; recheck requirements\./);
  });

  it("retains retired vote reasons as excluded history without adding them to the current tally", () => {
    const swarm = fixture("retired-history");
    for (const agent of AGENTS.slice(0, 4)) vote(swarm.id, agent, "accepted", `${agent} original evidence.`);
    vote(swarm.id, "Emma", "blocked", "Active dissent remains.");
    db.write(() => {
      db.sql
        .prepare("UPDATE participants SET retired_at = ? WHERE swarm_id = ? AND name = 'Maria'")
        .run(T0 + 1, swarm.id);
      db.sql.prepare("UPDATE swarms SET agent_amount = 4 WHERE id = ?").run(swarm.id);
      recordRosterAcceptanceChange(db, swarm.id, T0 + 1);
    });
    const text = buildRunResultText(db, outcomeOf(swarm.id, "finished"), BOARD, T0 + 1);
    assert.match(text, /Tally: 3 accepted, 0 incomplete, 1 blocked; 4\/4 agents voted\. Threshold: 3\/4/);
    const [current, archived] = text.split("Excluded retired-agent votes (not counted):");
    assert.doesNotMatch(current, /Maria original evidence/);
    assert.ok(archived?.includes("- Maria (run 1): accepted. Reason: Maria original evidence."));
    assert.match(current, /Emma.*Active dissent remains/);
  });

  it("returns one status document with goal, criteria, tally, messages and review steps, without wall bodies", () => {
    const swarm = fixture("auth-refactor", AGENTS.slice(0, 3));
    createPost(db, swarm.id, "Maria", { title: "Kickoff", text: "Private wall body, not the result." }, T0 + 1_000);
    sendMessage(db, swarm.id, "Maria", ["User"], "Which auth provider?", T0 + 4_000);
    sendMessage(db, swarm.id, "John", ["User"], "Done with UI.", T0 + 5_000);
    endRun(db, swarm.id, process.pid, "finished", END);

    const text = buildRunResultText(db, outcomeOf(swarm.id, "finished"), BOARD, END);
    assert.equal(
      text,
      [
        `Swarm "auth-refactor" (#${swarm.id}) finished execution. Run 1. 3 agents, 23m, $0.00, 0 tokens.`,
        "",
        `Goal: ${GOAL}`,
        "Acceptance criteria:",
        `1. ${CRITERIA[0]}`,
        `2. ${CRITERIA[1]}`,
        "",
        "Task verdict: unchecked (acceptance revision 0).",
        "Task completion is not accepted; unresolved work remains.",
        "Tally: 0 accepted, 0 incomplete, 0 blocked; 0/3 agents voted. Threshold: 3/3 matching accepted or blocked votes.",
        "",
        "Agent votes and reasons:",
        "No votes recorded.",
        "",
        `Board: ${BOARD}/s/${swarm.id}`,
        "Messages to User: 2, 2 unread (see board).",
        "",
        "Next: review the actual work (git status/diff, files mentioned on the wall, run tests),",
        "then summarise to the user. If the work is incomplete or wrong, call",
        `resume_swarm(${swarm.id}, "<what is wrong and what to do>").`,
      ].join("\n"),
    );
    assert.doesNotMatch(text, /Wall digest|Private wall body|Kickoff/);
  });

  it("reports a blocked threshold with missing votes rather than assuming unanimity", () => {
    const swarm = fixture();
    for (const agent of AGENTS.slice(0, 4)) vote(swarm.id, agent, "blocked", `${agent} needs owner approval.`);
    const text = buildRunResultText(db, outcomeOf(swarm.id, "finished"), BOARD, END);
    assert.match(text, /Task verdict: blocked/);
    assert.match(text, /Tally: 0 accepted, 0 incomplete, 4 blocked; 4\/5 agents voted\. Threshold: 4\/5/);
    assert.doesNotMatch(text, /Emma \(run/);
  });

  for (const end of ["stopped", "interrupted"] as const) {
    it(`does not turn recorded accepted votes into a completion verdict when ${end}`, () => {
      const swarm = fixture("halted", ["Maria"]);
      vote(swarm.id, "Maria", "accepted", "Checks passed before shutdown.");
      endRun(db, swarm.id, process.pid, end, END);
      const text = buildRunResultText(db, outcomeOf(swarm.id, end), null, END);
      assert.ok(text.includes(`Task verdict: not finalized (run ${end}; acceptance revision 1).`));
      assert.match(text, /Recorded vote verdict: accepted\. No completion verdict was finalized\./);
      assert.match(text, /Maria \(run 1\): accepted\. Reason: Checks passed before shutdown\./);
      assert.match(text, /\nBoard: not running\.\n/);
      assert.match(text, /\nMessages to User: none\.\n/);
      assert.doesNotMatch(text, /Task verdict: accepted|consensus|Wall digest/);
      if (end === "stopped") {
        assert.match(text, /was stopped \(tool aborted, all agents killed\)/);
        assert.match(text, /continue only if they want it, with resume_swarm\(/);
      } else {
        assert.match(text, /was interrupted \(this pi process lost the swarm's run lock\)/);
        assert.match(text, /resume_swarm\(.+continues the swarm/);
      }
    });
  }

  it("leaves a short status document and its progress details unchanged", async () => {
    const swarm = fixture();
    const result: RunToolResult = {
      content: [{ type: "text", text: buildRunResultText(db, outcomeOf(swarm.id, "finished"), BOARD, END) }],
      details: readRunProgress(db, swarm.id, END, BOARD),
    };
    assert.equal(await boundRunResult(result), result);
  });

  it("keeps crash diagnostics alongside the vote status", () => {
    const swarm = fixture();
    db.sql.prepare("UPDATE participants SET status = 'crashed' WHERE swarm_id = ? AND name = 'Liam'").run(swarm.id);
    const text = buildRunResultText(db, outcomeOf(swarm.id, "finished"), BOARD, END);
    assert.match(text, /Crashed and not revived: Liam\./);
    assert.match(text, /Task verdict: unchecked/);
  });
});
