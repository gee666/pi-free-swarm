import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunProgress } from "../../src/broker/run-progress.js";
import {
  PLAIN_THEME,
  renderCallLine,
  renderFinished,
  renderProgress,
  renderSwarmCall,
  renderToolResult,
  type RenderTheme,
} from "../../src/tools/render.js";

// Colours every segment, so the tests prove the text survives styling.
const ansiTheme: RenderTheme = {
  fg: (_color, text) => `\x1b[36m${text}\x1b[39m`,
  bold: (text) => `\x1b[1m${text}\x1b[22m`,
};
const strip = (lines: string[]) => lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));

function progress(overrides: Partial<RunProgress> = {}): RunProgress {
  return {
    swarmId: 3,
    swarmName: "auth-refactor",
    run: 1,
    status: "running",
    agents: { pending: 0, starting: 1, working: 3, idle: 1, crashed: 0, stopped: 0 },
    posts: 14,
    messages: 22,
    unreadForUser: 2,
    elapsedMs: 12 * 60_000 + 5_000,
    cost: 1.234,
    tokens: 1_900_000,
    boardUrl: "http://127.0.0.1:3010",
    ...overrides,
  };
}

describe("renderProgress", () => {
  it("shows the three plan lines while running", () => {
    assert.deepEqual(strip(renderProgress(progress(), ansiTheme).render(120)), [
      "⬢ Swarm auth-refactor #3 · 5 agents: 3 working · 1 idle · 1 starting",
      "  14 posts · 22 messages · 2 for you · 12m · $1.23",
      "  Board: http://127.0.0.1:3010/s/3",
    ]);
  });

  it("drops the board line without a host and 'for you' without unread messages", () => {
    const lines = strip(renderProgress(progress({ boardUrl: null, unreadForUser: 0, run: 2 }), ansiTheme).render(120));
    assert.deepEqual(lines, [
      "⬢ Swarm auth-refactor #3 · run 2 · 5 agents: 3 working · 1 idle · 1 starting",
      "  14 posts · 22 messages · 12m · $1.23",
    ]);
  });

  it("fits every line into the width", () => {
    for (const line of strip(renderProgress(progress(), ansiTheme).render(30))) assert.ok(line.length <= 30, line);
  });
});

describe("renderFinished", () => {
  const cases: [RunProgress["status"], string][] = [
    ["finished", "⬢ Swarm auth-refactor #3 finished · 23m · $4.12 · board: http://127.0.0.1:3010/s/3"],
    ["stopped", "⬢ Swarm auth-refactor #3 stopped · 23m · $4.12 · board: http://127.0.0.1:3010/s/3"],
    ["interrupted", "⬢ Swarm auth-refactor #3 interrupted · 23m · $4.12 · board: http://127.0.0.1:3010/s/3"],
  ];
  for (const [status, expected] of cases) {
    it(`collapses a ${status} swarm to one line`, () => {
      const done = progress({ status, elapsedMs: 23 * 60_000, cost: 4.12 });
      assert.deepEqual(strip(renderFinished(done, ansiTheme).render(200)), [expected]);
    });
  }
});

describe("tool box composition", () => {
  const callLine = renderSwarmCall({ swarm_name: "auth-refactor", agent_amount: 5 }, PLAIN_THEME);

  it("shows the call line only until execution starts", () => {
    assert.deepEqual(renderCallLine(callLine, false).render(80), ["⬢ Swarm auth-refactor · 5 agents"]);
    assert.deepEqual(renderCallLine(callLine, true).render(80), []);
  });

  it("renders partial, final and error results", () => {
    const content = [{ type: "text" as const, text: "result text" }];
    const running = renderToolResult(
      { content, details: progress() },
      { expanded: false, isPartial: true },
      PLAIN_THEME,
      {
        isError: false,
        callLine,
      },
    );
    assert.equal(running.render(120).length, 3);
    const done = progress({ status: "finished" });
    const final = renderToolResult({ content, details: done }, { expanded: false, isPartial: false }, PLAIN_THEME, {
      isError: false,
      callLine,
    });
    assert.equal(final.render(200).length, 1);
    const expanded = renderToolResult({ content, details: done }, { expanded: true, isPartial: false }, PLAIN_THEME, {
      isError: false,
      callLine,
    });
    assert.deepEqual(
      expanded
        .render(200)
        .slice(1)
        .map((line) => line.trimEnd()),
      ["result text"],
    );
    const error = renderToolResult(
      { content: [{ type: "text", text: "agent_amount must be between 2 and 8 (got 12)." }], details: {} },
      { expanded: false, isPartial: false },
      PLAIN_THEME,
      { isError: true, callLine },
    );
    assert.deepEqual(error.render(120), [
      "⬢ Swarm auth-refactor · 5 agents",
      "  agent_amount must be between 2 and 8 (got 12).",
    ]);
  });
});
