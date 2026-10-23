import assert from "node:assert/strict";
import { test } from "node:test";
import { readConfigurationEdit as parseEdit } from "../../src/server/configuration-input.js";

function readConfigurationEdit(body: Record<string, unknown>) {
  return parseEdit({ expectedRun: 1, ...body });
}
import { ApiFailure } from "../../src/server/api-util.js";

test("configuration HTTP inputs preserve one explicit revisioned change", () => {
  for (const change of [
    { type: "addAgents", count: 2 },
    { type: "removeAgent", name: "Maria" },
    { type: "raiseBudget", moneyUsd: 4, timeSeconds: 120 },
  ]) {
    assert.deepEqual(readConfigurationEdit({ expectedRevision: 0, change }), {
      expectedRun: 1,
      expectedRevision: 0,
      change,
    });
  }
  assert.deepEqual(readConfigurationEdit({ expectedRevision: 2, change: { type: "removeAgent", name: " maria " } }), {
    expectedRun: 1,
    expectedRevision: 2,
    change: { type: "removeAgent", name: "maria" },
  });
});

test("invalid control fields are repairable and cannot inject retirement or unsupported config", () => {
  const invalid: { body: Record<string, unknown>; field: string }[] = [
    {
      body: { expectedRun: undefined, expectedRevision: 0, change: { type: "addAgents", count: 1 } },
      field: "expectedRun",
    },
    { body: { expectedRun: 0, expectedRevision: 0, change: { type: "addAgents", count: 1 } }, field: "expectedRun" },
    { body: { change: { type: "addAgents", count: 1 } }, field: "expectedRevision" },
    { body: { expectedRevision: -1, change: {} }, field: "expectedRevision" },
    { body: { expectedRevision: 0, change: [] }, field: "change" },
    ...[0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1].map((count) => ({
      body: { expectedRevision: 0, change: { type: "addAgents", count } },
      field: "change.count",
    })),
    { body: { expectedRevision: 0, change: { type: "removeAgent", name: " " } }, field: "change.name" },
    { body: { expectedRevision: 0, change: { type: "raiseBudget" } }, field: "change" },
    { body: { expectedRevision: 0, change: { type: "raiseBudget", moneyUsd: null } }, field: "change.moneyUsd" },
    {
      body: { expectedRevision: 0, change: { type: "raiseBudget", timeSeconds: Number.POSITIVE_INFINITY } },
      field: "change.timeSeconds",
    },
    { body: { expectedRevision: 0, change: { type: "addAgents", count: 1, model: "unapproved" } }, field: "change" },
    {
      body: { expectedRevision: 0, change: { type: "retireAgent", name: "Maria", handoffFile: "/etc/passwd" } },
      field: "change.type",
    },
  ];
  for (const { body, field } of invalid) {
    assert.throws(
      () => readConfigurationEdit(body),
      (error) => {
        assert.ok(error instanceof ApiFailure);
        assert.equal(error.status, 400);
        assert.equal(error.field, field);
        return true;
      },
    );
  }
});
