import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { AgentProcess } from "../../src/agents/agent-process.js";
import { PI_COMMAND_ENV, WATCHER_NAME } from "../../src/constants.js";
import { startSwarm, stopAllRuns } from "../../src/broker/swarm-run.js";
import { createRunFixture, newestSwarmId } from "./run-fixture.js";

test("confirmed missing launch path rejects before further worker attempts or revives", async () => {
  const run = createRunFixture({});
  const previous = process.env[PI_COMMAND_ENV];
  const attempts: string[] = [];
  const spawn = AgentProcess.spawn;
  const tracked = mock.method(AgentProcess, "spawn", (...args: Parameters<typeof AgentProcess.spawn>) => {
    attempts.push(args[0].name);
    return spawn(...args);
  });
  try {
    process.env[PI_COMMAND_ENV] = "/nonexistent/pi-free-swarm-startup-command";
    await assert.rejects(
      startSwarm(
        run.env,
        {
          name: "missing launch path",
          taskPrompt: "Fixture task.",
          acceptanceCriteria: ["Fixture complete."],
          agentAmount: 4,
        },
        {},
      ),
      /failed shared startup:.*ENOENT/,
    );
    assert.equal(attempts.filter((name) => name !== WATCHER_NAME).length, 1);
    const id = newestSwarmId(run.db);
    const revives = run.db.sql.prepare("SELECT SUM(revive_count) AS n FROM participants WHERE swarm_id = ?").get(id);
    assert.equal(revives?.n, 0);
  } finally {
    await stopAllRuns();
    tracked.mock.restore();
    if (previous === undefined) delete process.env[PI_COMMAND_ENV];
    else process.env[PI_COMMAND_ENV] = previous;
    run.cleanup();
  }
});
