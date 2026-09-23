// The swarm tools' terminal box (plan §9): the call line while the model streams the arguments, one to
// three live status lines while the swarm runs, one line once it is done.
import type { AgentToolResult, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { ParticipantStatus, SwarmStatus } from "../api-types.js";
import type { RunProgress } from "../broker/run-progress.js";
import { formatCost, formatElapsed, plural, swarmBoardUrl } from "./run-format.js";

export type RenderTheme = Pick<Theme, "fg" | "bold">;

/** For the plain-text copy of the status that partial results carry for non-TUI clients. */
export const PLAIN_THEME: RenderTheme = { fg: (_color, text) => text, bold: (text) => text };

const GLYPH = "⬢";
const STATUS_ORDER: readonly ParticipantStatus[] = ["working", "idle", "starting", "pending", "crashed", "stopped"];

class Lines implements Component {
  constructor(private readonly build: () => string[]) {}
  render(width: number): string[] {
    return width <= 0 ? [] : this.build().map((line) => truncateToWidth(line, width, "…"));
  }
  invalidate(): void {}
}

const EMPTY: Component = new Lines(() => []);

function title(progress: RunProgress, theme: RenderTheme): string {
  const run = progress.run > 1 ? ` · run ${progress.run}` : "";
  return `${theme.fg("accent", GLYPH)} ${theme.fg("toolTitle", theme.bold(`Swarm ${progress.swarmName}`))} ${theme.fg("muted", `#${progress.swarmId}${run}`)}`;
}

function agentCounts(progress: RunProgress, theme: RenderTheme): string {
  const total = STATUS_ORDER.reduce((sum, status) => sum + progress.agents[status], 0);
  const parts = STATUS_ORDER.filter((status) => progress.agents[status] > 0).map((status) => {
    const text = `${progress.agents[status]} ${status}`;
    return status === "crashed" ? theme.fg("error", text) : theme.fg("muted", text);
  });
  return `${theme.fg("muted", `${plural(total, "agent")}:`)} ${parts.join(theme.fg("muted", " · "))}`;
}

/** Line 1: title and agents by status; line 2: activity, time, cost; line 3: the board link. */
export function progressLines(progress: RunProgress, theme: RenderTheme): string[] {
  const sep = theme.fg("muted", " · ");
  const activity = [
    theme.fg("muted", plural(progress.posts, "post")),
    theme.fg("muted", plural(progress.messages, "message")),
  ];
  if (progress.unreadForUser > 0) activity.push(theme.fg("warning", `${progress.unreadForUser} for you`));
  activity.push(theme.fg("muted", formatElapsed(progress.elapsedMs)), theme.fg("muted", formatCost(progress.cost)));
  const lines = [`${title(progress, theme)}${sep}${agentCounts(progress, theme)}`, `  ${activity.join(sep)}`];
  const url = swarmBoardUrl(progress.boardUrl, progress.swarmId);
  if (url !== null) lines.push(`  ${theme.fg("muted", "Board:")} ${theme.fg("mdLink", url)}`);
  return lines;
}

const END_COLOR: Record<SwarmStatus, "success" | "warning" | "error" | "muted"> = {
  finished: "success",
  stopped: "warning",
  interrupted: "error",
  starting: "muted",
  running: "muted",
};

/** `⬢ Swarm auth-refactor #3 finished · 23m · $4.12 · board: <url>` */
export function finishedLine(progress: RunProgress, theme: RenderTheme): string {
  const sep = theme.fg("muted", " · ");
  const parts = [
    `${title(progress, theme)} ${theme.fg(END_COLOR[progress.status], progress.status)}`,
    theme.fg("muted", formatElapsed(progress.elapsedMs)),
    theme.fg("muted", formatCost(progress.cost)),
  ];
  const url = swarmBoardUrl(progress.boardUrl, progress.swarmId);
  if (url !== null) parts.push(`${theme.fg("muted", "board:")} ${theme.fg("mdLink", url)}`);
  return parts.join(sep);
}

export function renderProgress(progress: RunProgress, theme: RenderTheme): Component {
  return new Lines(() => progressLines(progress, theme));
}

export function renderFinished(progress: RunProgress, theme: RenderTheme): Component {
  return new Lines(() => [finishedLine(progress, theme)]);
}

export function renderSwarmCall(args: { swarm_name?: string; agent_amount?: number }, theme: RenderTheme): string {
  const amount = args.agent_amount === undefined ? "" : theme.fg("muted", ` · ${plural(args.agent_amount, "agent")}`);
  return `${theme.fg("accent", GLYPH)} ${theme.fg("toolTitle", theme.bold(`Swarm ${args.swarm_name ?? ""}`))}${amount}`;
}

export function renderResumeCall(args: { swarm_id?: number; message?: string }, theme: RenderTheme): string {
  const id = args.swarm_id === undefined ? "" : ` #${args.swarm_id}`;
  const message = args.message === undefined ? "" : theme.fg("muted", ` · ${args.message.replace(/\s+/g, " ")}`);
  return `${theme.fg("accent", GLYPH)} ${theme.fg("toolTitle", theme.bold(`Resume swarm${id}`))}${message}`;
}

function isRunProgress(value: unknown): value is RunProgress {
  return (
    typeof value === "object" &&
    value !== null &&
    "swarmId" in value &&
    typeof value.swarmId === "number" &&
    "agents" in value &&
    typeof value.agents === "object"
  );
}

function resultText(result: AgentToolResult<unknown>): string {
  return result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

/**
 * The call line shows only until execution starts; after that the result owns the box, so the running
 * view is exactly the status lines and the done view exactly one line.
 */
export function renderCallLine(line: string, executionStarted: boolean): Component {
  return executionStarted ? EMPTY : new Lines(() => [line]);
}

export function renderToolResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: RenderTheme,
  context: { isError: boolean; callLine: string },
): Component {
  const details = result.details;
  if (!isRunProgress(details)) {
    const color = context.isError ? "error" : "muted";
    return new Lines(() => [context.callLine, `  ${theme.fg(color, resultText(result).split("\n")[0] ?? "")}`]);
  }
  if (options.isPartial) return renderProgress(details, theme);
  if (!options.expanded) return renderFinished(details, theme);
  const expanded = new Container();
  expanded.addChild(renderFinished(details, theme));
  expanded.addChild(new Text(theme.fg("toolOutput", resultText(result)), 0, 0));
  return expanded;
}
