import assert from "node:assert/strict";
import { test } from "node:test";
import { StartupAdmission } from "../../src/broker/startup-admission.js";
import type { AgentCrash } from "../../src/agents/supervisor.js";

const candidate = (name: string, launchKey = "a") => ({ name, launchKey, launchFirst: async () => undefined });
const crash = (reason: AgentCrash["reason"], fatal = true): AgentCrash => ({
  reason,
  fatal,
  message: "fixture failure",
  exitCode: 1,
  signal: null,
  stderrTail: "",
});

test("each assigned configuration gates on its actual first ready worker", () => {
  const started: string[] = [];
  const failures: Error[] = [];
  const admission = new StartupAdmission(
    (agent) => started.push(agent.name),
    (error) => failures.push(error),
  );
  const a = candidate("a");
  const b = candidate("b");
  const c = candidate("c", "second-model");
  const d = candidate("d", "second-model");
  for (const agent of [a, b, c, d]) admission.admit(agent);
  assert.deepEqual(started, ["a", "c"]);
  admission.ready(b);
  assert.deepEqual(started, ["a", "c"]);
  admission.ready(a);
  assert.deepEqual(started, ["a", "c", "b"]);
  admission.ready(c);
  assert.deepEqual(started, ["a", "c", "b", "d"]);
  assert.deepEqual(failures, []);
});

test("confirmed shared fatal startup failure closes admission immediately", () => {
  const started: string[] = [];
  const failures: Error[] = [];
  const admission = new StartupAdmission(
    (agent) => started.push(agent.name),
    (error) => failures.push(error),
  );
  const a = candidate("a");
  admission.admit(a);
  admission.admit(candidate("b"));
  assert.equal(admission.crashed(a, crash("extension_load_failed")), true);
  admission.admit(candidate("c", "other-model"));
  admission.ready(a);
  assert.deepEqual(started, ["a"]);
  assert.match(failures[0]?.message ?? "", /shared startup.*fixture failure/);
});

test("transient failures retain gate until recovered readiness", () => {
  const started: string[] = [];
  const admission = new StartupAdmission(
    (agent) => started.push(agent.name),
    () => assert.fail("unexpected shared failure"),
  );
  const a = candidate("a");
  admission.admit(a);
  admission.admit(candidate("b"));
  assert.equal(admission.crashed(a, crash("spawn_error", false)), false);
  assert.deepEqual(started, ["a"]);
  admission.ready(a);
  assert.deepEqual(started, ["a", "b"]);
  admission.close();
  admission.admit(candidate("c"));
  assert.deepEqual(started, ["a", "b"]);
});

test("per-worker prompt rejection does not establish shared fatal failure", () => {
  const failures: Error[] = [];
  const admission = new StartupAdmission(
    () => undefined,
    (error) => failures.push(error),
  );
  const a = candidate("a");
  admission.admit(a);
  assert.equal(admission.crashed(a, crash("prompt_rejected")), false);
  assert.deepEqual(failures, []);
  assert.equal(admission.crashed(a, { ...crash("prompt_rejected"), sharedStartupFailure: "steering-mode" }), true);
  assert.equal(failures.length, 1);
});

test("isolated frame failure promotes another real worker without aborting healthy peers", () => {
  const started: string[] = [];
  const admission = new StartupAdmission(
    (agent) => started.push(agent.name),
    () => assert.fail("unexpected shared failure"),
  );
  const a = candidate("a");
  const b = candidate("b");
  admission.admit(a);
  admission.admit(b);
  admission.admit(candidate("c"));
  assert.equal(admission.crashed(a, crash("protocol_overflow")), false);
  assert.deepEqual(started, ["a", "b"]);
  admission.ready(a);
  assert.deepEqual(started, ["a", "b"]);
  admission.ready(b);
  assert.deepEqual(started, ["a", "b", "c"]);
});
