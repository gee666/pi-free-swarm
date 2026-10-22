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
const acceptanceCriteria = ["Docs cover installation.", "Examples pass."];
const CRITERIA_TEXT = "Main's acceptance criteria:\n1. Docs cover installation.\n2. Examples pass.";

test("agents receive shared facts, criteria and whole-task voting instructions", () => {
  const text = buildSystemPrompt({
    agentName: "Maria",
    swarmName: "Docs sprint",
    bodyMaxChars: 200,
    acceptanceCriteria,
  });
  assert.match(text, /^You are Maria, one of the agents in swarm "Docs sprint"/);
  assert.ok(text.includes("All agents share the working directory"));
  assert.ok(text.includes("Then check the wall and what the others are doing"));
  assert.ok(text.includes("Do not sit idle while the goal is unmet."));
  assert.ok(text.includes("there is no reminder cap"));
  assert.ok(text.includes("messages wake their recipients automatically"));
  assert.ok(text.includes(`${AGENT_TOOL.acceptance} with {"action":"inspect"}`));
  assert.ok(text.includes('{"action":"vote","verdict":"accepted","reason":'));
  assert.ok(text.includes("Give a nonempty reason"));
  assert.ok(text.includes("at least 70% of all workers vote the same terminal verdict, accepted or blocked"));
  assert.ok(text.includes("rounded up to a whole worker"));
  assert.ok(text.includes("Accepted and blocked votes do not combine; incomplete votes do not end the run"));
  assert.ok(text.includes("including crashed workers; Main, User and Watcher do not vote"));
  assert.ok(text.includes("even if agents are active or messages remain"));
  assert.ok(text.includes("not an enforced criterion-by-criterion assessment"));
  assert.ok(text.includes(CRITERIA_TEXT));
  assert.ok(text.includes("timeout"));
  assert.ok(text.includes("at most 200 characters; put longer material in a file and share its path"));
  assert.equal(
    text.replaceAll("Maria", "You"),
    buildSystemPrompt({ agentName: "You", swarmName: "Docs sprint", bodyMaxChars: 200, acceptanceCriteria }),
  );
});

test("kickoff preserves the task and supplies Main's criteria", () => {
  const taskPrompt = "Write docs.\nKeep exact formatting.";
  assert.equal(
    buildKickoffPrompt({ taskPrompt, acceptanceCriteria, messages: "" }),
    `Task for the swarm:\n${taskPrompt}\n\n${CRITERIA_TEXT}`,
  );
  assert.equal(
    buildKickoffPrompt({ taskPrompt, acceptanceCriteria, messages: MESSAGES }),
    `Task for the swarm:\n${taskPrompt}\n\n${CRITERIA_TEXT}\n\n${MESSAGES}`,
  );
});

test("resume and revive supply criteria and preserve routing headers and messages", () => {
  const resume = buildResumePrompt({ acceptanceCriteria, messages: MESSAGES });
  assert.ok(resume.startsWith(RESUME_PROMPT_HEADER));
  assert.ok(resume.includes(CRITERIA_TEXT));
  assert.ok(resume.endsWith(`\n\n${MESSAGES}`));
  const revive = buildRevivePrompt({ acceptanceCriteria, messages: MESSAGES });
  assert.ok(revive.startsWith(REVIVE_PROMPT_HEADER));
  assert.ok(revive.includes(CRITERIA_TEXT));
  assert.ok(revive.endsWith(`\n\n${MESSAGES}`));
});
