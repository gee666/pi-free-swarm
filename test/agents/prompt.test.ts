import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSystemPrompt,
  buildKickoffPrompt,
  buildResumePrompt,
  buildRevivePrompt,
} from "../../src/agents/prompt.js";

test("worker prompt covers the v2 workflow in order without inlining the brief", () => {
  const path = ".pi/swarm/work/1/brief.md";
  const prompt = buildSystemPrompt({ agentName: "Ann", swarmName: "Build", briefPath: path });
  const sections = [
    "Overview",
    "Brief",
    "Workflow",
    "Tasks and dependencies",
    "Voting duty",
    "Stop rules and blockers",
    "Skills",
    "Discovery",
    "Text limits",
    "Shared working tree",
    "Commands",
    "Identity",
  ];
  let previous = -1;
  for (const section of sections) {
    const position = prompt.indexOf(`## ${section}\n`);
    assert.ok(position > previous, section);
    previous = position;
  }
  for (const text of [
    path,
    "swarm_intent_update",
    "exhaustive",
    "make them findable",
    "end-to-end",
    "independent",
    "parallel",
    "not a task state",
    "you will be notified",
    "Do the linked tasks, when done, fully satisfy this criterion?",
    "without waiting for acceptance",
    "Vote covered",
    "Vote gap",
    "its reason must name the missing part",
    "Vote blocked",
    "reopen, handoff and dependency changes do not",
    "stale",
    "swarm finishes on its own",
    "no task is in review",
    "never a blocker",
    "swarm_skills_search",
    "not delivered automatically",
    "1:1",
    "60",
    "200",
    "timeout",
    "Ann",
    "Build",
  ])
    assert.ok(prompt.includes(text), text);
  assert.doesNotMatch(
    prompt,
    /swarm-task|swarm_acceptance|70%|quorum|bodyMaxChars|versioned|user approval|wait for User|vote satisfied|vote incomplete|vote only after/i,
  );
});

test("kickoff starts with project discovery; recovery preserves the graph and avoids replay", () => {
  assert.match(buildResumePrompt({ messages: "" }), /brief file has a new "Update for run N" section/);
  assert.equal(buildKickoffPrompt({ messages: "" }), "Start: call swarm_project.");
  for (const prompt of [buildResumePrompt({ messages: "Feedback" }), buildRevivePrompt({ messages: "Feedback" })]) {
    assert.match(prompt, /swarm_project/);
    assert.match(prompt, /do not replay writes/);
    assert.match(prompt, /Feedback$/);
    assert.doesNotMatch(prompt, /acceptance criteria:|quorum|whole-task/);
  }
});
