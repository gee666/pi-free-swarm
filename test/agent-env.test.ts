import assert from "node:assert/strict";
import { it } from "node:test";
import { readAgentEnv } from "../src/agent-mode.js";
import { AGENT_NAME_ENV, DB_ENV, RUN_ENV, RUNNER_PID_ENV, SWARM_ID_ENV } from "../src/constants.js";

const identity = {
  [DB_ENV]: "/workspace/swarm.db",
  [SWARM_ID_ENV]: "3",
  [AGENT_NAME_ENV]: "Maria",
  [RUNNER_PID_ENV]: "42",
};

it("requires a positive safe launch run in the agent environment", () => {
  for (const run of [undefined, "", "0", "-1", "1.5", "NaN", "9007199254740992"]) {
    assert.deepEqual(readAgentEnv({ ...identity, [RUN_ENV]: run }), {
      ok: false,
      error: `pi-free-swarm agent mode: missing or invalid ${RUN_ENV}; swarm tools disabled.`,
    });
  }
});

it("captures the launch run rather than inferring a current database run", () => {
  assert.deepEqual(readAgentEnv({ ...identity, [RUN_ENV]: "2" }), {
    ok: true,
    value: { dbPath: "/workspace/swarm.db", swarmId: 3, run: 2, agentName: "Maria", runnerPid: 42 },
  });
});
