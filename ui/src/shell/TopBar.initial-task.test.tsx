import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TextFilePreview } from "../../../src/api-file-types";
import { FilePreviewProvider } from "../components/FilePreview";
import { detail } from "../pages/agents/testFixtures";
import { installDialogFixture } from "../test/dialogFixture";
import { installFakeApi, type FakeApi } from "../test/fakeApi";
import { TopBar } from "./TopBar";

let api: FakeApi;
let restoreDialog = () => {};
const route = "/api/swarms/3/files/preview";

beforeEach(() => {
  api = installFakeApi();
  restoreDialog = installDialogFixture();
});

afterEach(() => {
  cleanup();
  restoreDialog();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens the full initial task from the first detail action and previews its attachment", async () => {
  const ending = "Final original-task instruction.";
  const task = `# Original instructions\n\n${"Detailed requirement. ".repeat(500)}\n\n${ending}\n\nRead tmp/task-attachment.md`;
  const data = detail({
    taskPrompt: task,
    budget: {
      moneyUsd: null,
      timeSeconds: null,
      costUsd: 0,
      activeTimeMs: 0,
      gracefulShutdown: true,
      exhausted: null,
      stopReason: null,
      moneyOvershootUsd: 0,
      timeOvershootSeconds: 0,
      accounting: "Test accounting",
    },
  });
  const preview: TextFilePreview = {
    kind: "text",
    path: "tmp/task-attachment.md",
    mimeType: "text/plain",
    text: "Attachment requirements remain readable.",
    offset: 0,
    nextOffset: null,
    complete: true,
    totalBytes: new TextEncoder().encode("Attachment requirements remain readable.").length,
    version: "v1",
  };
  api.on("GET", route, () => preview);
  render(
    <FilePreviewProvider swarmId="3">
      <TopBar swarms={[data.swarm]} current={data.swarm} detail={data} onSelectSwarm={() => undefined} />
    </FilePreviewProvider>,
  );
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Initial task" });
  const verdict = screen.getByRole("button", { name: /Task acceptance/ });
  const configuration = screen.getByRole("button", { name: "Run configuration" });
  const budget = screen.getByRole("button", { name: /Budget accounting/i });
  expect(trigger.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(verdict.compareDocumentPosition(configuration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(configuration.compareDocumentPosition(budget) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText(task)).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Original instructions" })).not.toBeInTheDocument();
  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(await screen.findByRole("heading", { name: "Original instructions" })).toBeInTheDocument();
  expect(screen.getByText((text) => text.endsWith(ending))).toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "tmp/task-attachment.md" }));
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(dialog).toHaveTextContent(preview.text));
  expect(api.callsTo("GET", route)[0]?.query.get("path")).toBe("tmp/task-attachment.md");
  await user.click(screen.getByRole("button", { name: /close/i }));
  await user.click(verdict);
  expect(screen.queryByText(/^Original task:/)).not.toBeInTheDocument();
});
