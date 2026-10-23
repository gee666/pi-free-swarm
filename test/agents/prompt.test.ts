import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildKickoffPrompt,
  buildResumePrompt,
  buildRevivePrompt,
  buildSystemPrompt,
} from "../../src/agents/prompt.js";
import { AGENT_TOOL, RESUME_PROMPT_HEADER, REVIVE_PROMPT_HEADER } from "../../src/constants.js";

const MESSAGES = '[swarm message #3] thread #1 · from Main · to: Maria, You\n"Fix the tests"';
const taskPrompt = "Review docs only.\nDo not edit files.";
const acceptanceCriteria = ["Docs cover installation.", "Examples pass."];
const CRITERIA_TEXT = "Main's acceptance criteria:\n1. Docs cover installation.\n2. Examples pass.";

test("agents receive shared facts, criteria and whole-task voting instructions", () => {
  const text = buildSystemPrompt({
    agentName: "Maria",
    swarmName: "Docs sprint",
    bodyMaxChars: 200,
    taskPrompt,
    acceptanceCriteria,
  });
  assert.match(text, /^You are one of the agents working on one shared task/);
  assert.ok(text.endsWith('You are Maria, one of the agents in swarm "Docs sprint".'));
  assert.ok(text.includes(`<swarm-task>\n${taskPrompt}\n</swarm-task>`));
  assert.equal(text.split(taskPrompt).length - 1, 1);
  assert.equal(text.split(CRITERIA_TEXT).length - 1, 1);
  assert.ok(text.includes("All agents share the working directory"));
  assert.ok(text.includes("Then check the wall and what the others are doing"));
  assert.ok(text.includes("Do not sit idle while the goal is unmet."));
  assert.ok(text.includes("there is no reminder cap"));
  assert.ok(text.includes("messages wake their recipients automatically"));
  assert.ok(text.includes(`${AGENT_TOOL.acceptance} with {"action":"inspect"}`));
  assert.ok(text.includes('{"action":"vote","verdict":"accepted","reason":'));
  assert.ok(text.includes("Give a nonempty reason"));
  assert.ok(text.includes("at least 70% of all active workers vote the same terminal verdict, accepted or blocked"));
  assert.ok(text.includes("rounded up to a whole worker"));
  assert.ok(text.includes("Accepted and blocked votes do not combine; incomplete votes do not end the run"));
  assert.ok(text.includes("including crashed workers; retired workers are excluded"));
  assert.ok(text.includes("Main, User and Watcher do not vote"));
  assert.ok(text.includes("even if agents are active or messages remain"));
  assert.ok(text.includes("not an enforced criterion-by-criterion assessment"));
  assert.ok(text.includes(CRITERIA_TEXT));
  assert.ok(text.includes("timeout"));
  assert.ok(text.includes("at most 200 characters; put longer material in a file and share its path"));
  assert.equal(
    text.replaceAll("Maria", "You"),
    buildSystemPrompt({
      agentName: "You",
      swarmName: "Docs sprint",
      bodyMaxChars: 200,
      taskPrompt,
      acceptanceCriteria,
    }),
  );
});

test("kickoff starts work without duplicating the task or criteria", () => {
  const kickoff = buildKickoffPrompt({ messages: "" });
  assert.match(kickoff, /Begin the shared task in your system instructions/);
  assert.ok(!kickoff.includes(taskPrompt));
  assert.ok(!kickoff.includes(CRITERIA_TEXT));
  assert.equal(buildKickoffPrompt({ messages: MESSAGES }), `${kickoff}\n\n${MESSAGES}`);
});

test("common prefix preserves restrictions and advisory ownership before identity", () => {
  const prompt = (agentName: string) =>
    buildSystemPrompt({ agentName, swarmName: "Docs sprint", bodyMaxChars: 200, taskPrompt, acceptanceCriteria });
  const maria = prompt("Maria");
  const lee = prompt("Lee");
  assert.equal(maria.slice(0, maria.lastIndexOf("You are Maria")), lee.slice(0, lee.lastIndexOf("You are Lee")));
  assert.ok(maria.includes("Prefer one shared wall post for each substantial task"));
  assert.ok(
    maria.includes(
      "use its comments for claims, ownership, discussion, decisions, implementation history, results and handoffs",
    ),
  );
  assert.ok(maria.includes("Check for an existing task post before opening another"));
  assert.ok(maria.includes("Other posts are allowed for announcements or other purposes"));
  assert.ok(maria.includes("Ownership is advisory, not an exclusive lock"));
  assert.ok(maria.includes("Tiny tasks do not need a ceremony or repetitive status reports"));
  assert.ok(maria.includes("A review-only task does not authorize edits"));
  assert.ok(maria.includes("raise actual conflicts rather than weakening restrictions"));
  assert.ok(maria.includes("leave it pending and take other useful work"));
  assert.ok(maria.includes("do not invent work solely because quorum has not formed"));
});

test("resume and revive supply criteria and preserve routing headers and messages", () => {
  const resume = buildResumePrompt({ acceptanceCriteria, messages: MESSAGES });
  assert.ok(resume.startsWith(RESUME_PROMPT_HEADER));
  assert.ok(resume.includes(CRITERIA_TEXT));
  assert.ok(resume.includes("last available handoff/result post"));
  assert.ok(resume.includes("never automatically replay writes or actions whose effects are uncertain"));
  assert.ok(resume.endsWith(`\n\n${MESSAGES}`));
  const revive = buildRevivePrompt({ acceptanceCriteria, messages: MESSAGES });
  assert.ok(revive.startsWith(REVIVE_PROMPT_HEADER));
  assert.ok(revive.includes(CRITERIA_TEXT));
  assert.ok(revive.includes("last available handoff/result post"));
  assert.ok(revive.includes("Verify that they still match current files and requirements"));
  assert.ok(revive.includes("If the handoff is missing or stale, inspect original history and evidence"));
  assert.ok(revive.includes("never automatically replay writes or actions whose effects are uncertain"));
  assert.ok(revive.endsWith(`\n\n${MESSAGES}`));
});
