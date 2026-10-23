import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { configuration } from "../test/runConfigurationFixture";
import { RunConfiguration } from "./RunConfiguration";
import { WorkerModel } from "./WorkerModel";

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

it("distinguishes live revision changes from resume-time differences", async () => {
  render(<RunConfiguration configuration={{ ...configuration, revision: 2, changes: ["workers"] }} />);
  await userEvent.click(screen.getByRole("button", { name: "Run configuration" }));
  expect(screen.getByText("Changed in runtime revision 2: workers")).toBeInTheDocument();
  expect(screen.getByText("Run 2 · configuration version 1 · runtime revision 2")).toBeInTheDocument();
  expect(screen.queryByText(/Changed on resume/)).not.toBeInTheDocument();
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
