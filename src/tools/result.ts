// What `swarm` and `resume_swarm` return to the main agent (plan §6.1): the finished state and the whole
// wall, never a summary written by the agents. The main agent reviews the real work itself.
import { USER_NAME, WALL_DIGEST_MAX_POSTS } from "../constants.js";
import type { RunEndStatus } from "../broker/swarms.js";
import { readRunProgress } from "../broker/run-progress.js";
import type { RunOutcome } from "../broker/swarm-run.js";
import type { SwarmDb } from "../store/db.js";
import { listInboxAfter, unreadCounts } from "../store/message-queries.js";
import { listParticipants } from "../store/swarm-queries.js";
import { listPosts } from "../store/wall-queries.js";
import { formatCost, formatElapsed, formatTokens, plural, swarmBoardUrl } from "./run-format.js";

const END_TEXT: Record<RunEndStatus, string> = {
  finished: "finished",
  stopped: "was stopped (tool aborted, all agents killed)",
  interrupted: "was interrupted (this pi process lost the swarm's run lock)",
};

export function buildRunResultText(db: SwarmDb, outcome: RunOutcome, boardUrl: string | null, now: number): string {
  const { swarm, run, end } = outcome;
  const progress = readRunProgress(db, swarm.id, now, boardUrl);
  const crashed = listParticipants(db, swarm.id).flatMap((p) =>
    p.kind === "agent" && p.status === "crashed" ? [p.name] : [],
  );
  const url = swarmBoardUrl(boardUrl, swarm.id);
  const lines = [
    `Swarm "${swarm.name}" (#${swarm.id}) ${END_TEXT[end]}. Run ${run}. ${plural(swarm.agentAmount, "agent")}, ` +
      `${formatElapsed(progress.elapsedMs)}, ${formatCost(progress.cost)}, ${formatTokens(progress.tokens)} tokens.`,
  ];
  if (crashed.length > 0) lines.push(`Crashed and not revived: ${crashed.join(", ")}.`);
  lines.push(url === null ? "Board: not running." : `Board: ${url}`, "", ...wallDigest(db, swarm.id), "");
  lines.push(userMessagesLine(db, swarm.id), "", ...nextSteps(swarm.id, end));
  return lines.join("\n");
}

function wallDigest(db: SwarmDb, swarmId: number): string[] {
  const page = listPosts(db, swarmId, { count: WALL_DIGEST_MAX_POSTS, offset: 0 });
  if (page.total === 0) return ["Wall: no posts."];
  // The newest posts carry the final status reports, so a capped digest keeps those.
  const header =
    page.total > page.posts.length
      ? `Wall digest (newest ${page.posts.length} of ${page.total} posts, oldest first; older ones on the board):`
      : "Wall digest (all posts, oldest first):";
  const posts = [...page.posts].reverse();
  return [
    header,
    ...posts.map(
      (post) => `#${post.id} ${post.author}: "${post.title}" — ${post.text} (${plural(post.commentCount, "comment")})`,
    ),
  ];
}

function userMessagesLine(db: SwarmDb, swarmId: number): string {
  const total = listInboxAfter(db, swarmId, USER_NAME, 0).length;
  if (total === 0) return `Messages to ${USER_NAME}: none.`;
  const unread = unreadCounts(db, swarmId, [USER_NAME])[USER_NAME] ?? 0;
  return `Messages to ${USER_NAME}: ${total}${unread > 0 ? `, ${unread} unread` : ""} (see board).`;
}

function nextSteps(swarmId: number, end: RunEndStatus): string[] {
  const resume = `resume_swarm(${swarmId}, "<what is wrong and what to do>")`;
  if (end === "finished") {
    return [
      "Next: review the actual work (git status/diff, files mentioned on the wall, run tests),",
      "then summarise to the user. If the work is incomplete or wrong, call",
      `${resume}.`,
    ];
  }
  if (end === "stopped") {
    return [
      "Next: the work is unfinished. Tell the user what state it is in (git status/diff, wall);",
      `continue only if they want it, with ${resume}.`,
    ];
  }
  return [
    "Next: the work is probably unfinished. Review it (git status/diff, wall) and tell the user;",
    `${resume} continues the swarm.`,
  ];
}
