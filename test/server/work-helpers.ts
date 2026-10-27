import assert from "node:assert/strict";
import type { CreateCriterionRequest, CriterionRecord, TaskRecord } from "../../src/api-types.js";
import { seedSwarm } from "../helpers/temp-db.js";
import { postJson, startTestBoard } from "./helpers.js";

export async function workBoard() {
  const board = await startTestBoard();
  const swarm = seedSwarm(board.temp.db, { now: Date.now() });
  const url = (path: string) => `${board.base}/api/swarms/${swarm.id}${path}`;
  return { ...board, swarm, url };
}
export type WorkBoard = Awaited<ReturnType<typeof workBoard>>;
export const criterionInput: CreateCriterionRequest = {
  group: "HTTP",
  title: "Serve the work graph",
  body: "Users can inspect work",
  verification: "Run HTTP tests",
  source: "spec §9",
};
export async function createHttpCriterion(board: WorkBoard, fields: Partial<CreateCriterionRequest> = {}) {
  const result = await postJson<CriterionRecord>(board.url("/criteria"), { ...criterionInput, ...fields });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}
export async function createHttpTask(board: WorkBoard, criterionId: number, fields: Record<string, unknown> = {}) {
  const result = await postJson<TaskRecord>(board.url("/tasks"), {
    title: "Build HTTP",
    body: "Implement the endpoints",
    criteria: [{ criterionId, contribution: "Expose the graph" }],
    ...fields,
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}
export async function action(board: WorkBoard, id: number, name: string, body: object = {}) {
  const result = await postJson<TaskRecord>(board.url(`/tasks/${id}/${name}`), body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
