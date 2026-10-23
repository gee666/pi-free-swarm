import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FilePreview, TextFilePreview } from "../../../src/api-file-types";
import { installDialogFixture } from "../test/dialogFixture";
import { installFakeApi, jsonResponse, type FakeApi } from "../test/fakeApi";
import { FileLink, FilePreviewProvider } from "./FilePreview";
import { Markdown } from "./Markdown";
import { RichText } from "./RichText";

const route = "/api/swarms/3/files/preview";
let api: FakeApi;
let restoreDialog = () => {};
beforeEach(() => {
  restoreDialog = installDialogFixture();
  api = installFakeApi();
});
afterEach(() => {
  cleanup();
  restoreDialog();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function textPage(path: string, text: string, patch: Partial<TextFilePreview> = {}): TextFilePreview {
  return {
    kind: "text",
    path,
    mimeType: "text/plain",
    text,
    offset: 0,
    nextOffset: null,
    complete: true,
    totalBytes: new TextEncoder().encode(text).length,
    version: "v1",
    ...patch,
  };
}
const closeButton = () => screen.getByRole("button", { name: /close/i });
const nextButton = () => screen.getByRole("button", { name: /more|next|continue/i });

it("opens plain and inline-code file references, highlights code safely and releases the view on close", async () => {
  const code = '\n\nconst answer = 42;\nconst unsafe = "<img src=x onerror=alert(1)>";';
  api.on("GET", route, ({ query }) => textPage(query.get("path") ?? "", code));
  render(
    <FilePreviewProvider swarmId="3">
      <RichText text="Review src/example.ts:8:2" />
      <Markdown source="Also `README.md`." />
    </FilePreviewProvider>,
  );
  const trigger = screen.getByRole("link", { name: "src/example.ts:8:2" });
  expect(screen.getByRole("link", { name: "README.md" })).toBeInTheDocument();
  expect(api.callsTo("GET", route)).toHaveLength(0);
  await userEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(dialog).toHaveTextContent("const answer = 42;"));
  expect(api.callsTo("GET", route)[0].query.get("path")).toBe("src/example.ts");
  await waitFor(() => expect(dialog.querySelector(".hljs-keyword")).not.toBeNull());
  expect(dialog.querySelector('code[data-language="typescript"]')?.textContent).toBe(code);
  expect(dialog.querySelector("img")).toBeNull();
  expect(dialog.querySelector("script")).toBeNull();
  await userEvent.click(closeButton());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  await waitFor(() => expect(api.callsTo("GET", route)).toHaveLength(2));
});

it.each(["constructor", "__proto__"])("renders the unregistered %s language as inert plain text", async (extension) => {
  const reference = `src/example.${extension}`;
  const content = "Unregistered code <img src=x onerror=alert(1)>";
  api.on("GET", route, () => textPage(reference, content));
  render(
    <FilePreviewProvider swarmId="3">
      <FileLink reference={reference}>Unknown file</FileLink>
    </FilePreviewProvider>,
  );
  await userEvent.click(screen.getByRole("link", { name: "Unknown file" }));
  expect(await screen.findByText(content)).toBeInTheDocument();
  expect(screen.getByRole("dialog").querySelector("img")).toBeNull();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps malformed UTF-16 file targets inert instead of throwing during render", () => {
  const reference = "bad\ud800.md";
  render(
    <FilePreviewProvider swarmId="3">
      <Markdown source={`[invalid](${reference})`} />
      <FileLink reference={reference}>Manual invalid target</FileLink>
    </FilePreviewProvider>,
  );
  expect(screen.getByText("invalid")).toBeInTheDocument();
  expect(screen.getByText("Manual invalid target")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(api.callsTo("GET", route)).toHaveLength(0);
});

it("preserves the actual swarm's space-containing absolute file reference", async () => {
  const reference = "/project/tmp/user-replac agents.md";
  api.on("GET", route, () => textPage("tmp/user-replac agents.md", "Handoff body"));
  render(
    <FilePreviewProvider swarmId="3">
      <RichText text={`Read ${reference}`} />
    </FilePreviewProvider>,
  );
  await userEvent.click(screen.getByRole("link", { name: reference }));
  expect(await screen.findByText("Handoff body")).toBeInTheDocument();
  expect(api.callsTo("GET", route)[0].query.get("path")).toBe(reference);
});

it("renders local Markdown links in an overlay without enabling raw HTML or unsafe protocols", async () => {
  api.on("GET", route, () =>
    textPage(
      "docs/handoff.md",
      "# Handoff\n\n**Verified** artifact.\n\n<script>bad()</script>\n\n[unsafe](javascript:alert(1))",
    ),
  );
  render(
    <FilePreviewProvider swarmId="3">
      <Markdown source="Read [handoff](docs/handoff.md)." />
    </FilePreviewProvider>,
  );
  await userEvent.click(screen.getByRole("link", { name: "handoff" }));
  expect(await screen.findByRole("heading", { name: "Handoff" })).toBeInTheDocument();
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Verified").tagName).toBe("STRONG");
  expect(dialog.querySelector("script")).toBeNull();
  expect(within(dialog).queryByRole("link", { name: "unsafe" })).not.toBeInTheDocument();
  const event = new Event("cancel", { cancelable: true });
  fireEvent(dialog, event);
  if (!event.defaultPrevented && dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("follows explicit relative Markdown targets with spaces while keeping a single overlay", async () => {
  api.on("GET", route, ({ query }) =>
    query.get("path") === "docs/start.md"
      ? textPage(
          "docs/start.md",
          "# Start\n\nRead [next](notes/my%20notes.md), [config](.env) or [script](scripts/run).",
        )
      : textPage("docs/notes/my notes.md", "# Next file\n\nUpdated evidence."),
  );
  render(
    <FilePreviewProvider swarmId="3">
      <FileLink reference="docs/start.md">Root document</FileLink>
    </FilePreviewProvider>,
  );
  const trigger = screen.getByRole("link", { name: "Root document" });
  await userEvent.click(trigger);
  await screen.findByRole("heading", { name: "Start" });
  expect(within(screen.getByRole("dialog")).getByRole("link", { name: "config" })).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getByRole("link", { name: "script" })).toBeInTheDocument();
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("link", { name: "next" }));
  expect(await screen.findByRole("heading", { name: "Next file" })).toBeInTheDocument();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(api.callsTo("GET", route)[1].query.get("path")).toBe("docs/notes/my notes.md");
  await userEvent.click(closeButton());
  expect(trigger).toHaveFocus();
});

it("uses the bounded raster-content URL instead of injecting image documents", async () => {
  const url = "/api/swarms/3/files/content?path=assets%2Fpicture.png&version=v1";
  api.on("GET", route, () => ({
    kind: "image",
    path: "assets/picture.png",
    mimeType: "image/png",
    url,
    totalBytes: 100,
    version: "v1",
  }));
  render(
    <FilePreviewProvider swarmId="3">
      <FileLink reference="assets/picture.png">Picture</FileLink>
    </FilePreviewProvider>,
  );
  await userEvent.click(screen.getByRole("link", { name: "Picture" }));
  expect(await screen.findByRole("img")).toHaveAttribute("src", url);
  expect(screen.getByRole("dialog").querySelector("iframe")).toBeNull();
  await userEvent.click(closeButton());
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

it("continues bounded text pages using exact returned bytes and version", async () => {
  api.on("GET", route, ({ query }) =>
    query.get("offset") === "5"
      ? textPage("logs/output.txt", "tail\n", { offset: 5, totalBytes: 10 })
      : textPage("logs/output.txt", "head\n", { nextOffset: 5, complete: false, totalBytes: 10 }),
  );
  render(
    <FilePreviewProvider swarmId="3">
      <FileLink reference="logs/output.txt">Output</FileLink>
    </FilePreviewProvider>,
  );
  await userEvent.click(screen.getByRole("link", { name: "Output" }));
  await screen.findByText("head");
  await userEvent.click(nextButton());
  await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("tail"));
  expect(screen.getByRole("dialog")).not.toHaveTextContent("head");
  const next = api.callsTo("GET", route)[1];
  expect(next.query.get("offset")).toBe("5");
  expect(next.query.get("version")).toBe("v1");
  expect(nextButton()).toBeDisabled();
  expect(screen.getByRole("dialog")).toHaveTextContent("End of file");
});

it("shows scoped read failures rather than navigating to arbitrary filesystem paths", async () => {
  api.on("GET", route, () => jsonResponse(403, { error: "forbidden", message: "Path is outside this project" }));
  render(
    <FilePreviewProvider swarmId="3">
      <FileLink reference="../secret.txt">Secret</FileLink>
    </FilePreviewProvider>,
  );
  await userEvent.click(screen.getByRole("link", { name: "Secret" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Path is outside this project");
  expect(screen.getByRole("dialog").querySelector("iframe")).toBeNull();
});

it("aborts a closed file and ignores its late response after another file is opened", async () => {
  let release = () => {};
  const pending = new Promise<FilePreview>((resolve) => {
    release = () => resolve(textPage("old.txt", "Retired file response"));
  });
  api.on("GET", route, ({ query }) =>
    query.get("path") === "old.txt" ? pending : textPage("new.txt", "Current file response"),
  );
  render(
    <FilePreviewProvider swarmId="3">
      <FileLink reference="old.txt">Old</FileLink>
      <FileLink reference="new.txt">New</FileLink>
    </FilePreviewProvider>,
  );
  await userEvent.click(screen.getByRole("link", { name: "Old" }));
  const signal = vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[1]?.signal;
  try {
    await userEvent.click(closeButton());
    expect(signal?.aborted).toBe(true);
    await userEvent.click(screen.getByRole("link", { name: "New" }));
    expect(await screen.findByText("Current file response")).toBeInTheDocument();
  } finally {
    await act(async () => {
      release();
      await pending;
    });
  }
  expect(screen.getByRole("dialog")).toHaveTextContent("Current file response");
  expect(screen.queryByText("Retired file response")).not.toBeInTheDocument();
});

it("keeps generated full-text footers outside a truncated Markdown fence without linking arbitrary code", async () => {
  const reference = ".pi/swarm/bodies/full.md";
  api.on("GET", route, () => textPage(reference, "# Full original\n\nComplete attachment body."));
  render(
    <FilePreviewProvider swarmId="3">
      <Markdown source={`\`\`\`ts\nconst preview = 1; … [full text: ${reference}]`} />
      <Markdown source={"```txt\nsrc/not-a-reference.ts\n```"} />
    </FilePreviewProvider>,
  );
  const link = screen.getByRole("link", { name: reference });
  expect(link.closest("pre")).toBeNull();
  expect(screen.queryByRole("link", { name: "src/not-a-reference.ts" })).not.toBeInTheDocument();
  await userEvent.click(link);
  expect(await screen.findByRole("heading", { name: "Full original" })).toBeInTheDocument();
  expect(api.callsTo("GET", route)[0].query.get("path")).toBe(reference);
});

it("does not merge changed file versions and allows an explicit fresh preview", async () => {
  let changed = false;
  api.on("GET", route, ({ query }) => {
    if (query.get("offset") === "5") {
      changed = true;
      return jsonResponse(409, { error: "conflict", message: "File changed; open a fresh preview" });
    }
    return changed
      ? textPage("logs/output.txt", "Fresh version", { version: "v2" })
      : textPage("logs/output.txt", "head\n", { nextOffset: 5, complete: false, totalBytes: 10 });
  });
  render(
    <FilePreviewProvider swarmId="3">
      <FileLink reference="logs/output.txt">Output</FileLink>
    </FilePreviewProvider>,
  );
  await userEvent.click(screen.getByRole("link", { name: "Output" }));
  await screen.findByText("head");
  await userEvent.click(nextButton());
  expect(await screen.findByRole("alert")).toHaveTextContent("File changed");
  await userEvent.click(screen.getByRole("button", { name: "Reload file" }));
  expect(await screen.findByText("Fresh version")).toBeInTheDocument();
  expect(api.callsTo("GET", route)).toHaveLength(3);
  expect(api.callsTo("GET", route).at(-1)?.query.get("offset")).toBe("0");
  expect(api.callsTo("GET", route).at(-1)?.query.get("version")).toBeNull();
});
