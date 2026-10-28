import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { it, expect } from "vitest";
import { SwarmViewProvider } from "../../api/SwarmView";
import { installFakeApi } from "../../test/fakeApi";
import { installFakeEventSource } from "../../test/fakeEventSource";
import { agent, detail } from "../agents/testFixtures";
import { WatcherPage } from "./WatcherPage";

it("directs questions to the Wall and preserves Watcher activity without chat", async () => {
  const source = installFakeEventSource();
  const api = installFakeApi();
  const snapshot = detail();
  snapshot.participants.push(agent("Watcher", 4, { activity: { kind: "thinking" } }));
  api.on("GET", "/api/swarms/3", () => snapshot);
  render(
    <MemoryRouter initialEntries={["/s/3/watcher"]}>
      <Routes>
        <Route
          path="/s/:id/watcher"
          element={
            <SwarmViewProvider swarmId="3">
              <WatcherPage />
            </SwarmViewProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  act(() => source().open());
  expect(await screen.findByRole("status")).toHaveTextContent("Watcher: working");
  expect(screen.getByText("Mention @Watcher in a post or comment to ask it something")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the Wall" })).toHaveAttribute("href", "/s/3/wall");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
