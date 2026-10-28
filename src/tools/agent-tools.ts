import type { ExtensionToolContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AGENT_TOOL as T, WATCHER_NAME } from "../constants.js";
export { IDLE_ONLY_TOOLS } from "../constants.js";
import { snoozeReminders } from "../broker/reminder-snooze.js";
import { requestRetirement } from "../broker/retirement.js";
import { createRetirementTool, retirementToolParameters } from "./retirement-tool.js";
import type { Static, TSchema } from "typebox";
import * as S from "./agent-schemas.js";
import { registerTextTool, workInput, writeAgentTool, type AgentToolIdentity } from "./agent-tool-context.js";
export type { AgentToolIdentity } from "./agent-tool-context.js";
import { createWorkHandlers } from "./work-tool-handlers.js";
import { createReviewTool } from "./review-tool.js";
import { createSearchHandlers } from "./search-tool-handlers.js";
import { createCommunicationHandlers } from "./communication-tool-handlers.js";

export function createAgentToolHandlers(identity: AgentToolIdentity) {
  return {
    ...createWorkHandlers(identity),
    ...createSearchHandlers(identity),
    ...createCommunicationHandlers(identity),
    retire(params: Static<typeof retirementToolParameters>) {
      const result = writeAgentTool(identity, () =>
        requestRetirement(
          identity.getDb(),
          identity.swarmId,
          identity.agentName,
          identity.run,
          params.handoff,
          workInput(identity).now,
        ),
      );
      return `Replacement request #${result.requestId} queued. Handoff saved to \`${result.handoffPath}\`. Do not start more work or repeat this request.`;
    },
    snooze() {
      const until = writeAgentTool(identity, () =>
        snoozeReminders(identity.getDb(), identity.swarmId, identity.agentName, workInput(identity).now),
      );
      return `Idle reminders snoozed for 5 minutes, until ${new Date(until).toISOString()}. System notifications still arrive.`;
    },
  };
}
export function registerAgentTools(pi: Pick<ExtensionAPI, "registerTool">, identity: AgentToolIdentity): void {
  const run = createAgentToolHandlers(identity);
  function register<S extends TSchema>(
    name: string,
    parameters: S,
    description: string,
    execute: (params: Static<S>, ctx: ExtensionToolContext) => string | Promise<string>,
  ) {
    registerTextTool(pi, name, parameters, description, execute);
  }
  register(
    T.project,
    S.empty,
    "Read brief path, intent, stop gates, your queue and tool guide. Start here.",
    run.project,
  );
  register(
    T.criteriaSearch,
    S.criteriaSearch,
    "Search criteria and filter status, group, links or voting duty.",
    (params, ctx) => run.criteriaSearch(params, ctx.modelRegistry),
  );
  register(
    T.criteriaGet,
    S.byId,
    "Read a criterion, reasons, linked tasks, current/stale votes, blocker and posts.",
    run.criteriaGet,
  );
  register(
    T.criteriaVoteContext,
    S.paged,
    "Read your tasks, their criteria, other linked work and missing votes.",
    run.criteriaVoteContext,
  );
  register(
    T.tasksSearch,
    S.tasksSearch,
    "Search tasks; find runnable work, ownership and dependencies.",
    (params, ctx) => run.tasksSearch(params, ctx.modelRegistry),
  );
  register(
    T.tasksGet,
    S.tasksGet,
    "Read a task, criteria, forward/reverse dependencies, evidence, paged timeline and posts.",
    run.tasksGet,
  );
  register(
    T.postsSearch,
    S.postsSearch,
    "Search post titles, bodies and comments; filter author, links or subscription.",
    (params, ctx) => run.postsSearch(params, ctx.modelRegistry),
  );
  register(T.postsGet, S.tasksGet, "Read a post, links and a page of comments. Follow next cursor.", run.postsGet);
  register(T.skillsSearch, S.search, "Search project skills before writing new automation.", run.skillsSearch);
  register(T.skillsGet, S.skillsGet, "Read SKILL.md, validation state, file list and path.", run.skillsGet);
  register(
    T.postsCreate,
    identity.agentName === WATCHER_NAME ? S.watcherPostsCreate : S.postsCreate,
    "Create a post with optional links; auto-subscribes you. @Name notifies a participant without subscribing them. Only User and Watcher can broadcast to all workers.",
    run.postsCreate,
  );
  register(
    T.postsComment,
    S.postsComment,
    "Comment and auto-subscribe. Subscribers receive a short notice at most once per post every five minutes; read the post for all comments.",
    run.postsComment,
  );
  register(
    T.postsUnsubscribe,
    S.postId,
    "Stop future comment notifications, including after you comment again.",
    run.postsUnsubscribe,
  );
  if (identity.agentName === WATCHER_NAME) return;
  register(T.intentUpdate, S.intentUpdate, "Register the user intent summary and file path.", run.intentUpdate);
  register(
    T.criteriaCreate,
    S.criteriaCreate,
    "Create a testable grouped criterion covering the brief.",
    run.criteriaCreate,
  );
  register(
    T.criteriaEdit,
    S.criteriaEdit,
    "Edit a criterion at expected_revision; reread on conflict. Invalidates votes.",
    run.criteriaEdit,
  );
  register(T.criteriaArchive, S.byId, "Archive a criterion.", run.criteriaArchive);
  register(
    T.criteriaBlock,
    S.criteriaBlock,
    "Record an external blocker and resolution attempts. Waiting for another task is a dependency, never a blocker.",
    run.criteriaBlock,
  );
  register(
    T.criteriaVote,
    S.criteriaVote,
    "Judge coverage: Do the linked tasks, when done, fully satisfy this criterion? Vote covered, gap or blocked. A gap reason must name the missing part. Re-vote after criterion or task content/link edits, not lifecycle changes.",
    run.criteriaVote,
  );
  register(
    T.tasksCreate,
    S.tasksCreate,
    "Create linked work; optional claim atomically assigns it to you. Dependencies are task IDs, not blockers.",
    run.tasksCreate,
  );
  register(
    T.tasksEdit,
    S.tasksEdit,
    "Edit at expected_revision. Keep at least one criterion link. Dependencies must be acyclic.",
    run.tasksEdit,
  );
  register(T.tasksClaim, S.byId, "Claim new work or take over an inactive owner's task.", run.tasksClaim);
  register(T.tasksRelease, S.byId, "Release your task to new and unowned.", run.tasksRelease);
  register(
    T.tasksHandoff,
    S.tasksHandoff,
    "Hand off to an active agent. Review tasks cannot be handed off.",
    run.tasksHandoff,
  );
  register(
    T.tasksTransition,
    S.tasksTransition,
    "Start after dependencies are accepted; reopen accepted work with a reason. Use swarm_review for review.",
    run.tasksTransition,
  );
  pi.registerTool(createReviewTool(identity));
  register(T.postsLink, S.postsLink, "Link a post to tasks or criteria. Notifies task owners.", (params) =>
    run.postsLink(params),
  );
  register(T.postsUnlink, S.postsLink, "Remove task or criterion links from a post.", (params) =>
    run.postsLink(params, true),
  );
  register(
    T.snooze,
    S.empty,
    "After your first idle turn, snooze reminders for exactly 5 minutes. System notifications still arrive. Budgets and completion gates are unchanged.",
    run.snooze,
  );
  pi.registerTool(createRetirementTool(run.retire));
}
