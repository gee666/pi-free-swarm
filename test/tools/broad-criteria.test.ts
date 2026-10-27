import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemPrompt } from "../../src/agents/prompt.js";
import { createCriterion } from "../../src/broker/criteria.js";
import { CRITERION_BROAD_TASKS } from "../../src/constants.js";
import { getTask } from "../../src/store/tasks.js";
import { createAgentToolHandlers } from "../../src/tools/agent-tools.js";
import { workFixture } from "../helpers/work-graph.js";

test("task create/edit warn only when adding links to criteria beyond the broad-task limit", (t) => {
  const f = workFixture(t);
  const run = createAgentToolHandlers({ getDb: () => f.db, swarmId: f.swarmId, run: 1, agentName: "Ann" });
  const criteria = [{ criterion_id: f.criterion.id, contribution: "Implementation" }];
  for (let i = 0; i < CRITERION_BROAD_TASKS; i++)
    assert.doesNotMatch(run.tasksCreate({ title: `Task ${i}`, body: "Implement", criteria }), /too broad/);
  const output = run.tasksCreate({ title: "Ninth", body: "Implement", criteria });
  const warning = (count: number) =>
    `Criterion #${f.criterion.id} now links ${count} tasks: it is too broad. Split it into specific criteria (one testable behaviour each) and archive it.`;
  assert.ok(output.endsWith(warning(CRITERION_BROAD_TASKS + 1)));
  const other = createCriterion(f.db, {
    ...f.input(),
    group: "Other",
    title: "Specific",
    body: "Check",
    verification: "Test",
    source: "",
  });
  const task = f.task(other.id);
  const edited = run.tasksEdit({ id: task.id, expected_revision: task.revision, criteria });
  assert.ok(edited.endsWith(warning(CRITERION_BROAD_TASKS + 2)));
  const current = getTask(f.db, f.swarmId, task.id);
  assert.ok(current);
  assert.doesNotMatch(
    run.tasksEdit({
      id: task.id,
      expected_revision: current.revision,
      criteria: [{ ...criteria[0], criterion_id: f.criterion.id, contribution: "Clarified" }],
    }),
    /too broad/,
  );
  const prompt = buildSystemPrompt({ agentName: "Ann", swarmName: "demo", briefPath: "brief.md" });
  assert.match(
    prompt,
    /Each criterion is one specific testable behaviour \(inputs, edge cases, expected result\); split broad ones and archive the original\./,
  );
});
