import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { SwarmViewProvider } from "../api/SwarmView";
import { AgentsPage } from "../pages/agents/AgentsPage";
import { ParticipantList } from "../pages/agents/ParticipantList";
import { agent, detail, mailbox, mailboxThread, message, thread } from "../pages/agents/testFixtures";
import { WorkAgentList } from "../pages/work/WorkAgentList";
import { installFakeApi } from "../test/fakeApi";
import { installFakeEventSource } from "../test/fakeEventSource";
import { configuration } from "../test/runConfigurationFixture";

const retired = agent("Maria", 1, { status: "retired", model: configuration.effective.workers[0] });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("labels retired workers without hiding their selectable historical mailbox", async () => {
  const selected = vi.fn();
  render(<ParticipantList participants={[retired]} error={undefined} selected={undefined} onSelect={selected} />);
  expect(screen.getByText("retired")).toBeInTheDocument();
  expect(screen.getByText("Retired")).toBeInTheDocument();
  expect(screen.getByText("provider-a/model-a · thinking: high")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Maria" }));
  expect(selected).toHaveBeenCalledWith("Maria");
});

it("keeps retired work history available with an explicit retired label", () => {
  render(<WorkAgentList agents={[retired]} selected="Maria" onSelect={() => {}} />);
  expect(screen.getByRole("button", { name: "Maria" })).toBeInTheDocument();
  expect(screen.getByText("Retired")).toBeInTheDocument();
  expect(screen.getAllByText("retired")).toHaveLength(2);
});

it("preserves retired mailbox evidence but excludes retired workers from new-message recipients", async () => {
  const source = installFakeEventSource();
  const api = installFakeApi();
  const current = detail();
  api.on("GET", "/api/swarms/3", () => ({
    ...current,
    participants: [current.participants[0], retired, agent("John", 2)],
  }));
  const evidence = message(9, "User", [["Maria", "read"]], "Archived handoff evidence");
  api.on("GET", "/api/swarms/3/participants/Maria/messages", () =>
    mailbox("Maria", "inbox", [mailboxThread(thread(9, ["User", "Maria"]), [evidence], "Maria")]),
  );
  render(
    <MemoryRouter initialEntries={["/s/3/agents/Maria?compose=Maria"]}>
      <SwarmViewProvider swarmId="3">
        <Routes>
          <Route path="/s/:id/agents/:name" element={<AgentsPage />} />
        </Routes>
      </SwarmViewProvider>
    </MemoryRouter>,
  );
  act(() => source().open());
  expect(await screen.findByText("Archived handoff evidence")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove Maria" })).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Recipient" })).toHaveValue("");
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Select an agent", "John"]);
});
