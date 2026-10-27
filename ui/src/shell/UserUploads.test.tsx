import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PostSummary } from "../../../src/api-types";
import { SwarmViewProvider } from "../api/SwarmView";
import { AgentsPage } from "../pages/agents/AgentsPage";
import { detail, mailbox, message } from "../pages/agents/testFixtures";
import { WallPage } from "../pages/wall/WallPage";
import { installFakeApi, jsonResponse, type FakeApi } from "../test/fakeApi";
import { installFakeEventSource } from "../test/fakeEventSource";

const post: PostSummary = {
  id: 1,
  swarmId: 3,
  author: "Liam",
  title: "Upload discussion",
  text: "Review attachments.",
  commentCount: 0,
  createdAt: 1,
};
const uploadRoute = "/api/swarms/3/files/upload";
const uploadedPath = "tmp/swarm-upload-test/report-unique.png";
let api: FakeApi;
let openEvents: () => void;

beforeEach(() => {
  api = installFakeApi();
  const source = installFakeEventSource();
  openEvents = () => source().open();
  api.on("GET", "/api/swarms/3", () => detail());
  api.on("GET", "/api/swarms/3/posts", () => ({ posts: [post], total: 1 }));
  api.on("GET", "/api/swarms/3/posts/1", () => ({ post, comments: [] }));
  api.on("GET", "/api/swarms/3/participants/User/messages", () => mailbox("User", "inbox", []));
  api.on("POST", "/api/swarms/3/participants/User/read", () => ({ updated: 0, unread: 0 }));
  api.on("POST", uploadRoute, () => ({ path: uploadedPath }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <SwarmViewProvider swarmId="3">
        <Routes>
          <Route path="/s/:id/wall/:postId?" element={<WallPage />} />
          <Route path="/s/:id/agents/:name?" element={<AgentsPage />} />
        </Routes>
      </SwarmViewProvider>
    </MemoryRouter>,
  );
  act(openEvents);
}

it("uploads a selected file and submits only its returned path in a User post", async () => {
  api.on("POST", "/api/swarms/3/posts", () => ({ post: { ...post, id: 2 } }));
  api.on("GET", "/api/swarms/3/posts/2", () => ({ post: { ...post, id: 2 }, comments: [] }));
  mount("/s/3/wall/new");
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "Title" }), "Screenshot");
  const body = screen.getByRole("textbox", { name: "Body" });
  await user.type(body, "Please review");
  await user.upload(
    screen.getByLabelText("Upload files"),
    new File(["image bytes"], "report.png", { type: "image/png" }),
  );
  await waitFor(() => expect(body).toHaveValue(`Please review\n${uploadedPath}`));
  await user.click(screen.getByRole("button", { name: "Post" }));
  await waitFor(() => expect(api.callsTo("POST", "/api/swarms/3/posts")).toHaveLength(1));
  expect(api.callsTo("POST", "/api/swarms/3/posts")[0]?.body).toEqual({
    title: "Screenshot",
    text: `Please review\n${uploadedPath}`,
  });
  expect(api.callsTo("POST", uploadRoute)).toHaveLength(1);
});

it("pastes an image into a User comment and submits its saved path", async () => {
  api.on("POST", "/api/swarms/3/posts/1/comments", () => ({
    comment: { id: 1, postId: 1, swarmId: 3, author: "User", text: uploadedPath, createdAt: 2 },
    commentCount: 1,
  }));
  mount("/s/3/wall/1");
  const box = await screen.findByRole("textbox", { name: "Write a comment…" });
  const file = new File(["clipboard image"], "clipboard.png", { type: "image/png" });
  fireEvent.paste(box, {
    clipboardData: {
      files: [file],
      items: [{ kind: "file", type: file.type, getAsFile: () => file }],
      getData: () => "",
    },
  });
  await waitFor(() => expect(box).toHaveValue(uploadedPath));
  await userEvent.click(screen.getByRole("button", { name: "Comment" }));
  await waitFor(() =>
    expect(api.callsTo("POST", "/api/swarms/3/posts/1/comments")[0]?.body).toEqual({ text: uploadedPath }),
  );
  expect(api.callsTo("POST", uploadRoute)).toHaveLength(1);
});

it("preserves edits made while a file upload is pending and never auto-sends", async () => {
  let finish = () => {};
  api.on(
    "POST",
    uploadRoute,
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ path: uploadedPath });
      }),
  );
  mount("/s/3/wall/1");
  const box = await screen.findByRole("textbox", { name: "Write a comment…" });
  const user = userEvent.setup();
  await user.type(box, "Original");
  await user.upload(screen.getByLabelText("Upload files"), new File(["bytes"], "report.txt"));
  await waitFor(() => expect(api.callsTo("POST", uploadRoute)).toHaveLength(1));
  expect(screen.getByRole("button", { name: "Comment" })).toBeDisabled();
  await user.type(box, " edited");
  await act(async () => finish());
  await waitFor(() => expect(box).toHaveValue(`Original edited\n${uploadedPath}`));
  expect(api.callsTo("POST", "/api/swarms/3/posts/1/comments")).toHaveLength(0);
});

it("does not insert a pending upload into another post's comment draft after navigation", async () => {
  const other = { ...post, id: 2, title: "Other discussion" };
  api.on("GET", "/api/swarms/3/posts", () => ({ posts: [post, other], total: 2 }));
  api.on("GET", "/api/swarms/3/posts/2", () => ({ post: other, comments: [] }));
  let finish = () => {};
  api.on(
    "POST",
    uploadRoute,
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ path: uploadedPath });
      }),
  );
  mount("/s/3/wall/1");
  await screen.findByRole("textbox", { name: "Write a comment…" });
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("Upload files"), new File(["bytes"], "report.txt"));
  await waitFor(() => expect(api.callsTo("POST", uploadRoute)).toHaveLength(1));
  await user.click(within(screen.getByRole("region", { name: "Wall" })).getByText("Other discussion"));
  await screen.findByRole("heading", { level: 1, name: "Other discussion" });
  const otherBox = screen.getByRole("textbox", { name: "Write a comment…" });
  await user.type(otherBox, "Different task");
  await act(async () => finish());
  expect(otherBox).toHaveValue("Different task");
  expect(api.callsTo("POST", "/api/swarms/3/posts/2/comments")).toHaveLength(0);
});

it("keeps the draft unchanged and displays a failed upload without inserting a path", async () => {
  api.on("POST", uploadRoute, () => jsonResponse(413, { error: "too_large", message: "File exceeds upload limit." }));
  mount("/s/3/wall/1");
  const box = await screen.findByRole("textbox", { name: "Write a comment…" });
  const user = userEvent.setup();
  await user.type(box, "Keep this draft");
  await user.upload(screen.getByLabelText("Upload files"), new File(["bytes"], "report.txt"));
  expect(await screen.findByRole("alert")).toHaveTextContent("File exceeds upload limit.");
  expect(box).toHaveValue("Keep this draft");
  expect(screen.getByRole("button", { name: "Comment" })).toBeEnabled();
});

it("does not insert a pending file after the message recipient changes", async () => {
  let finish = () => {};
  api.on(
    "POST",
    uploadRoute,
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ path: uploadedPath });
      }),
  );
  mount("/s/3/agents/User?compose=Maria");
  const box = await screen.findByRole("textbox", { name: "Type a message…" });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Recipient" })).toHaveValue("Maria"));
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("Upload files"), new File(["bytes"], "report.txt"));
  await waitFor(() => expect(api.callsTo("POST", uploadRoute)).toHaveLength(1));
  await user.click(screen.getByRole("button", { name: "Send message: John" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Recipient" })).toHaveValue("John"));
  await user.type(box, "For John only");
  await act(async () => finish());
  expect(box).toHaveValue("For John only");
  expect(api.callsTo("POST", "/api/swarms/3/messages")).toHaveLength(0);
});

it("offers the same file picker for User messages without changing recipients", async () => {
  api.on("POST", "/api/swarms/3/messages", () => ({
    message: message(1, "User", [["Maria", "pending"]], uploadedPath),
  }));
  mount("/s/3/agents/User?compose=Maria");
  const box = await screen.findByRole("textbox", { name: "Type a message…" });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Recipient" })).toHaveValue("Maria"));
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText("Upload files"),
    new File(["document bytes"], "report.pdf", { type: "application/pdf" }),
  );
  await waitFor(() => expect(box).toHaveValue(uploadedPath));
  expect(
    within(screen.getByRole("region", { name: "Compose" })).getByRole("combobox", { name: "Recipient" }),
  ).toHaveValue("Maria");
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(api.callsTo("POST", "/api/swarms/3/messages")[0]?.body).toEqual({ to: "Maria", text: uploadedPath }),
  );
  expect(api.callsTo("POST", uploadRoute)).toHaveLength(1);
});
