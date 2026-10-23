import assert from "node:assert/strict";
import { it } from "node:test";
import { planAddedWorkerSlots, planWorkerRosterChange, replacementWorkerSlot } from "../../src/broker/worker-slots.js";
import { AGENT_NAMES } from "../../src/names.js";
import type { WorkerAssignment } from "../../src/run-configuration.js";
import { createRunFixture } from "../integration/run-fixture.js";

const modelA = { provider: "a", modelId: "one", thinkingLevel: "off" };
const modelB = { provider: "b", modelId: "two", thinkingLevel: "high" };
const slot = (name: string, model = modelA): WorkerAssignment => ({ name, ...model });

function fixture() {
  const f = createRunFixture({});
  f.env.launch.model = modelA;
  f.env.availableModels = [
    { provider: "a", id: "one", thinkingLevels: ["off"] },
    { provider: "b", id: "two", thinkingLevels: ["high"] },
  ];
  f.env.settings.models = [
    { provider: "a", model: "one", thinkingLevel: "off" },
    { provider: "b", model: "two", thinkingLevel: "high" },
  ];
  return f;
}

it("fills weighted deficits for added workers while preserving every existing named slot", () => {
  const f = fixture();
  try {
    f.env.settings.models = [
      { provider: "a", model: "one", thinkingLevel: "off", count_proportional: 3 },
      { provider: "b", model: "two", thinkingLevel: "high" },
    ];
    const current = [slot("Maria"), slot("John"), slot("Liam", modelB), slot("Mary", modelB)];
    const before = structuredClone(current);
    const added = planAddedWorkerSlots(f.env, current, ["Alice", "James", "Robert", "Linda"]);
    assert.deepEqual(
      added.map((worker) => worker.modelId),
      ["one", "one", "one", "one"],
    );
    assert.deepEqual(current, before);
    assert.equal(current.length + added.length, 8);
  } finally {
    f.cleanup();
  }
});

it("respects deterministic ties and tolerates retained overrepresentation after explicit removal", () => {
  const f = fixture();
  try {
    assert.deepEqual(
      planAddedWorkerSlots(f.env, [], ["Maria"]).map((worker) => worker.modelId),
      ["one"],
    );
    const current = [slot("Maria"), slot("John"), slot("Liam", modelB)];
    assert.deepEqual(planAddedWorkerSlots(f.env, current, ["Mary"]), [slot("Mary", modelB)]);
    const retained = [slot("Maria"), slot("John"), slot("Liam"), slot("Mary")];
    assert.deepEqual(planAddedWorkerSlots(f.env, retained, ["Alice", "James"]), [
      slot("Alice", modelB),
      slot("James", modelB),
    ]);
  } finally {
    f.cleanup();
  }
});

it("inherits Main for newly added slots without silently moving retained workers", () => {
  const f = fixture();
  try {
    f.env.settings.models = undefined;
    assert.deepEqual(planAddedWorkerSlots(f.env, [slot("Maria", modelB)], ["John"]), [slot("John")]);
    assert.throws(() => planAddedWorkerSlots(f.env, [slot("Maria")], ["maria"]), /identity/);
    assert.throws(() => planAddedWorkerSlots(f.env, [], ["Maria", "maria"]), /identity/);
    assert.deepEqual(planAddedWorkerSlots(f.env, [], []), []);
    f.env.settings.models = [{ provider: "missing", model: "unavailable", thinkingLevel: "off" }];
    assert.throws(() => planAddedWorkerSlots(f.env, [], ["John"]), /unavailable/);
  } finally {
    f.cleanup();
  }
});

it("plans explicit live roster edits within the captured cap and never reuses archived identities", () => {
  const f = fixture();
  try {
    const current = [slot("Maria"), slot("John", modelB)];
    const historical = AGENT_NAMES.slice(0, 6).map((name) => name.toLowerCase());
    const added = planWorkerRosterChange(f.env, current, { type: "addAgents", count: 1 }, historical, () => 0);
    assert.equal(added.length, 3);
    assert.deepEqual(added.slice(0, 2), current);
    assert.equal(historical.includes(added[2].name.toLowerCase()), false);
    const removed = planWorkerRosterChange(f.env, current, { type: "removeAgent", name: "maria" }, historical);
    assert.deepEqual(removed, [slot("John", modelB)]);
    const replacement = planWorkerRosterChange(
      f.env,
      current,
      { type: "retireAgent", name: "John", handoffFile: "handoff.md" },
      historical,
      () => 0,
    );
    assert.equal(replacement.length, current.length);
    assert.deepEqual(replacement[0], current[0]);
    assert.notEqual(replacement[1].name, "John");
    assert.equal(historical.includes(replacement[1].name.toLowerCase()), false);
    assert.deepEqual({ ...replacement[1], name: "John" }, current[1]);
    f.env.settings.maxAgents = 2;
    assert.throws(
      () => planWorkerRosterChange(f.env, current, { type: "addAgents", count: 1 }, historical),
      /maxAgents/,
    );
    assert.deepEqual(current, [slot("Maria"), slot("John", modelB)]);
    assert.throws(
      () => planWorkerRosterChange(f.env, [slot("Maria")], { type: "removeAgent", name: "Maria" }, []),
      /last active worker.*Stop/,
    );
    assert.throws(
      () => planWorkerRosterChange(f.env, current, { type: "removeAgent", name: "missing" }, []),
      /current active roster/,
    );
    assert.throws(
      () => planWorkerRosterChange(f.env, current, { type: "addAgents", count: 0 }, []),
      /positive safe integer/,
    );
    assert.throws(
      () =>
        planWorkerRosterChange(
          f.env,
          current,
          { type: "retireAgent", name: "Maria", handoffFile: "handoff.md" },
          AGENT_NAMES,
        ),
      /pool has 0/,
    );
  } finally {
    f.cleanup();
  }
});

it("replacements receive a fresh identity with the retiring worker's exact effective model and thinking", () => {
  const old = slot("Maria", modelB);
  assert.deepEqual(replacementWorkerSlot("John", old), slot("John", modelB));
  assert.deepEqual(old, slot("Maria", modelB));
  assert.throws(() => replacementWorkerSlot("maria", old), /fresh name/);
  assert.throws(() => replacementWorkerSlot(" ", old), /fresh name/);
});
