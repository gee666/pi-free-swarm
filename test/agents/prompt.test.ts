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

test("peers receive identity and interface facts, without assigned roles or polling policy", () => {
  const text = buildSystemPrompt({ agentName: "Maria", swarmName: "Docs sprint", bodyMaxChars: 200 });
  assert.match(text, /^You are Maria, a peer in swarm "Docs sprint"/);
  assert.ok(text.includes("All peers have the same tools"));
  assert.ok(text.includes("share the working directory"));
  assert.ok(text.includes("messages wake their recipients automatically"));
  assert.ok(text.includes(AGENT_TOOL.acceptance));
  assert.ok(text.includes("timeout"));
  assert.ok(text.includes("at most 200 characters; put longer material in a file and share its path"));
  assert.doesNotMatch(text, /200 chars|ORGANISE FIRST|periodically|There is no leader|Rules:/);
  assert.equal(
    text.replaceAll("Maria", "You"),
    buildSystemPrompt({ agentName: "You", swarmName: "Docs sprint", bodyMaxChars: 200 }),
  );
});

test("kickoff preserves the task verbatim without privileging the first peer", () => {
  assert.equal(buildKickoffPrompt({ taskPrompt: "Write docs.", messages: "" }), "Task for the swarm:\nWrite docs.");
  assert.equal(
    buildKickoffPrompt({ taskPrompt: "Write docs.", messages: MESSAGES }),
    `Task for the swarm:\nWrite docs.\n\n${MESSAGES}`,
  );
});

test("resume and revive preserve routing headers and supplied messages", () => {
  const resume = buildResumePrompt({ messages: MESSAGES });
  assert.ok(resume.startsWith(RESUME_PROMPT_HEADER));
  assert.ok(resume.endsWith(`\n\n${MESSAGES}`));
  const revive = buildRevivePrompt({ messages: MESSAGES });
  assert.ok(revive.startsWith(REVIVE_PROMPT_HEADER));
  assert.ok(revive.endsWith(`\n\n${MESSAGES}`));
});
