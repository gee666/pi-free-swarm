import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { it, expect } from "vitest";
import { AgentsPage } from "./AgentsPage";
import { SwarmViewProvider } from "../../api/SwarmView";
import { installFakeApi } from "../../test/fakeApi";
import { installFakeEventSource } from "../../test/fakeEventSource";
import { detail } from "./testFixtures";

it("shows participants and links to their activity, with no mailbox or composer", async () => {
  const source = installFakeEventSource();
  const api = installFakeApi();
  api.on("GET", "/api/swarms/3", () => detail());
  render(
    <MemoryRouter initialEntries={["/s/3/agents/John"]}>
      <Routes>
        <Route
          path="/s/:id/agents/:name"
          element={
            <SwarmViewProvider swarmId="3">
              <AgentsPage />
            </SwarmViewProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  act(() => source().open());
  expect(await screen.findByRole("link", { name: "View activity in Work" })).toHaveAttribute("href", "/s/3/work/John");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Mailbox" })).not.toBeInTheDocument();
  expect(api.callsTo("GET", "/api/swarms/3/participants/John/messages")).toHaveLength(0);
});
