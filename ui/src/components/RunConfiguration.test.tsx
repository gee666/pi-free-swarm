import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import type { SavedRunConfiguration } from "../../../src/run-configuration";
import { RunConfiguration } from "./RunConfiguration";
import { WorkerModel } from "./WorkerModel";

const configuration: SavedRunConfiguration = {
  run: 2,
  recordedAt: 123,
  changes: ["budget"],
  effective: {
    version: 1,
    workers: [{ name: "Maria", provider: "provider-a", modelId: "model-a", thinkingLevel: "high" }],
    launch: { projectTrusted: true, noExtensions: true, extensionArgs: [] },
    timing: {
      staggerSeconds: 1,
      idleReminderDelay: 500,
      idleReminderDigestSize: 3,
      heartbeatMs: 1000,
      deliveryPollMs: 100,
      completionCheckMs: 100,
      progressMs: 1000,
      resumeStaggerMs: 100,
      reviveBackoffMs: [100, 200],
    },
    limits: { bodyMaxChars: 200, maxRpcFrameBytes: 1048576 },
    budget: { moneyUsd: 10, timeSeconds: 300, gracefulShutdown: false },
  },
};

it("renders saved assignments, budget, resume differences and effective launch settings", async () => {
  render(<RunConfiguration configuration={configuration} />);
  await userEvent.click(screen.getByRole("button", { name: "Run configuration" }));
  expect(screen.getByText("Changed on resume: budget")).toBeInTheDocument();
  expect(screen.getByText("Maria: provider-a/model-a · thinking: high")).toBeInTheDocument();
  expect(screen.getByText(/Money: \$10 USD · active time: 300 seconds/)).toBeInTheDocument();
  expect(screen.getByText("On exhaustion: interrupt immediately.")).toBeInTheDocument();
  expect(screen.getByText(/Project trusted: yes · extensions: disabled/)).toBeInTheDocument();
  expect(screen.getByText("Worker stagger, seconds: 1")).toBeInTheDocument();
  expect(screen.getByText("Startup watchdog, ms: not recorded")).toBeInTheDocument();
});

it("does not invent historical metadata", async () => {
  render(<RunConfiguration configuration={null} />);
  await userEvent.click(screen.getByRole("button", { name: "Run configuration" }));
  expect(screen.getByText(/No configuration was recorded/)).toBeInTheDocument();
});

it("renders actual model and thinking with provider identity and an honest missing fallback", () => {
  const { rerender } = render(<WorkerModel model={configuration.effective.workers[0]} />);
  expect(screen.getByText("provider-a/model-a · thinking: high")).toHaveAttribute("title", "Provider: provider-a");
  rerender(<WorkerModel />);
  expect(screen.getByText("Model not recorded")).toBeInTheDocument();
});
