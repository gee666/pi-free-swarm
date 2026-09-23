import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildKickoffPrompt,
  buildResumePrompt,
  buildRevivePrompt,
  buildSystemPrompt,
} from "../../src/agents/prompt.js";
import { AGENT_TOOL, RESUME_PROMPT_HEADER, REVIVE_PROMPT_HEADER } from "../../src/constants.js";

const BASH_RULE =
  "Remember: always pass a timeout to every bash call; never run blocking servers/watchers in the foreground.";
test("every launch prompt repeats file coordination and message-wake anti-loop rules", () => {
  const prompts = [
    buildSystemPrompt({ agentName: "Maria", swarmName: "Test" }),
    buildKickoffPrompt({ taskPrompt: "Build it", wallIsEmpty: false, messages: "" }),
    buildResumePrompt({ messages: "" }),
    buildRevivePrompt({ messages: "" }),
  ];
  for (const prompt of prompts) {
    assert.ok(prompt.includes(`Immediately before editing, read the latest wall (${AGENT_TOOL.readPosts})`));
    assert.ok(prompt.includes("Resolve conflicting file ownership before touching files"));
    assert.ok(prompt.includes("Do not overwrite peer files"));
    assert.ok(prompt.includes("Never reply to Main feedback with an acknowledgment"));
    assert.ok(prompt.includes("post completion on the wall, not in messages"));
    assert.ok(
      prompt.includes("If woken by thanks, acknowledgments, sign-offs or repeated completion notices: do not reply"),
    );
    assert.ok(prompt.includes("end your turn without calling messaging tools"));
    assert.ok(prompt.includes("actionable questions, answers or new information needed by a specific recipient"));
  }
});

const MESSAGES = '[swarm message #3] thread #1 · from Main · to: Maria, You\n"Fix the tests"';

test("the system prompt names the agent, the swarm, every tool and the bash rule", () => {
  const text = buildSystemPrompt({ agentName: "Maria", swarmName: "Docs sprint" });
  assert.match(
    text,
    /^You are Maria, one of several peer agents in swarm "Docs sprint" working together on ONE task\./,
  );
  for (const tool of [
    AGENT_TOOL.readPosts,
    AGENT_TOOL.post,
    AGENT_TOOL.comment,
    AGENT_TOOL.replyTo,
    AGENT_TOOL.message,
  ]) {
    assert.ok(text.includes(tool), tool);
  }
  assert.match(text, /7\. BASH: ALWAYS pass a `timeout` \(seconds\) to EVERY bash call/);
});

test("kickoff: task, first-agent hint only on an empty wall, bash rule, messages last", () => {
  const empty = buildKickoffPrompt({ taskPrompt: "Write docs.", wallIsEmpty: true, messages: "" });
  assert.ok(
    empty.startsWith(`Task for the swarm:\nWrite docs.\n\nStart by reading the wall (${AGENT_TOOL.readPosts}).`),
  );
  assert.ok(empty.includes(`You are the first — post a short kickoff\n(${AGENT_TOOL.post})`));
  assert.ok(empty.endsWith(BASH_RULE));
  const busy = buildKickoffPrompt({ taskPrompt: "Write docs.", wallIsEmpty: false, messages: MESSAGES });
  assert.ok(!busy.includes("You are the first"));
  assert.ok(busy.endsWith(`${BASH_RULE}\n\n${MESSAGES}`));
});

test("resume and revive start with their headers and repeat the bash rule", () => {
  const resume = buildResumePrompt({ messages: MESSAGES });
  assert.ok(resume.startsWith(`${RESUME_PROMPT_HEADER} Main sent feedback`));
  assert.ok(resume.includes(BASH_RULE));
  assert.ok(resume.endsWith(`\n\n${MESSAGES}`));

  const revive = buildRevivePrompt({ messages: "" });
  assert.ok(revive.startsWith(REVIVE_PROMPT_HEADER));
  assert.ok(revive.includes(`(${AGENT_TOOL.readPosts}, ${AGENT_TOOL.readThread})`));
  assert.ok(revive.includes(BASH_RULE));
  assert.ok(revive.endsWith("A hung command may be why you were restarted."));
});
