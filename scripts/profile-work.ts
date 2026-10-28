import { performance } from "node:perf_hooks";
import { seedPerformanceFixture } from "../test/helpers/performance-fixture.js";
import { startTestBoard } from "../test/server/helpers.js";
import { createWorkHandlers } from "../src/tools/work-tool-handlers.js";
import { createSearchHandlers } from "../src/tools/search-tool-handlers.js";
import { ownWorkQueue } from "../src/broker/work-queries.js";

const board = await startTestBoard();
try {
  const fixture = seedPerformanceFixture(board.temp.db);
  const identity = {
    getDb: () => board.temp.db,
    swarmId: fixture.swarm.id,
    run: 1,
    agentName: fixture.agents[0] ?? "",
  };
  const work = createWorkHandlers(identity);
  const search = createSearchHandlers(identity);
  const reads: [string, () => unknown | Promise<unknown>][] = [
    ...[
      "",
      "/criteria",
      "/criteria/groups",
      `/criteria/${fixture.criteria[0]}`,
      "/tasks",
      `/tasks/${fixture.tasks[0]}`,
      "/dashboard",
      "/stats",
      "/posts",
    ].map<[string, () => Promise<unknown>]>((path) => [
      `GET ${path || "/:id"}`,
      async () => {
        const response = await fetch(`${board.base}/api/swarms/${fixture.swarm.id}${path}`);
        if (response.status !== 200) throw new Error(`${response.status}: ${await response.text()}`);
        return response.json();
      },
    ]),
    ["swarm_project", work.project],
    ["swarm_criteria_vote_context", () => work.criteriaVoteContext({})],
    ["swarm_criteria_search", () => search.criteriaSearch({})],
    ["swarm_tasks_search", () => search.tasksSearch({})],
    ["swarm_criteria_get", () => work.criteriaGet({ id: fixture.criteria[0] ?? 0 })],
    ["swarm_tasks_get", () => work.tasksGet({ id: fixture.tasks[0] ?? 0 })],
    ["own queue", () => ownWorkQueue(board.temp.db, fixture.swarm.id, identity.agentName)],
  ];
  console.log("500 criteria, 300 tasks, 2000 votes, 45 agents. Milliseconds; first read and median of 3 warm reads.");
  for (const [name, read] of reads) {
    const samples: number[] = [];
    for (let i = 0; i < 4; i++) {
      const start = performance.now();
      await read();
      samples.push(performance.now() - start);
    }
    const cold = samples.shift() ?? 0;
    samples.sort((a, b) => a - b);
    console.log(`${name}: first=${cold.toFixed(2)} median=${samples[1]?.toFixed(2)}`);
  }
} finally {
  await board.close();
}
