import type { Static } from "typebox";
import * as S from "./agent-schemas.js";
import { checkedQuery, workInput, type AgentToolIdentity } from "./agent-tool-context.js";
import {
  getTaskDetail,
  getCriterionDetail,
  searchCriterionCandidates,
  searchTaskCandidates,
} from "../broker/work-queries.js";
import { searchPostCandidates } from "../broker/post-queries.js";
import { runSearch, type SearchHelper, type SearchResult } from "../search/index.js";
import { syncSkillsAndNotify } from "../broker/skill-sync.js";
import { searchSkills, getSkill } from "../skills/index.js";
import { BrokerError } from "../broker/errors.js";
import { taskLine } from "./work-tool-handlers.js";

function resultLines<T>(result: SearchResult<T>, line: (item: T) => string): string {
  return [
    ...result.items.map(line),
    `Next cursor: ${result.nextCursor ?? "none"}`,
    `Search: ${result.mode}`,
    ...result.notes,
  ].join("\n");
}
export function createSearchHandlers(identity: AgentToolIdentity) {
  return {
    async tasksSearch(params: Static<typeof S.tasksSearch>, helper?: SearchHelper) {
      const db = identity.getDb();
      const candidates = db.read(() =>
        searchTaskCandidates(db, identity.swarmId, identity.agentName, {
          status: params.status,
          owner: params.owner,
          author: params.author,
          criterionId: params.criterion_id,
          runnable: params.runnable,
          waiting: params.waiting,
          mine: params.mine,
        }).map((candidate) => ({
          ...candidate,
          id: String(candidate.id),
          line: taskLine(getTaskDetail(db, identity.swarmId, candidate.id)),
        })),
      );
      const result = await runSearch({
        db,
        kind: "task",
        candidates,
        query: checkedQuery(params.query),
        cursor: params.cursor,
        limit: params.limit,
        helper,
      });
      return resultLines(result, (item) => item.line);
    },
    async criteriaSearch(params: Static<typeof S.criteriaSearch>, helper?: SearchHelper) {
      const db = identity.getDb();
      const candidates = db.read(() =>
        searchCriterionCandidates(db, identity.swarmId, identity.agentName, {
          status: params.status,
          group: params.group,
          taskId: params.task_id,
          author: params.author,
          needsMyVote: params.needs_my_vote,
          includeArchived: params.include_archived,
        }).map((candidate) => ({
          ...candidate,
          id: String(candidate.id),
          detail: getCriterionDetail(db, identity.swarmId, candidate.id),
        })),
      );
      const result = await runSearch({
        db,
        kind: "criterion",
        candidates,
        query: checkedQuery(params.query),
        cursor: params.cursor,
        limit: params.limit,
        helper,
      });
      return resultLines(result, (item) => {
        const criterion = item.detail;
        return `#${item.id} [${criterion.archivedAt ? "archived" : criterion.status}] ${item.title} · ${criterion.group}`;
      });
    },
    async postsSearch(params: Static<typeof S.postsSearch>, helper?: SearchHelper) {
      const db = identity.getDb();
      const candidates = db.read(() =>
        searchPostCandidates(db, identity.swarmId, identity.agentName, {
          author: params.author,
          taskId: params.task_id,
          criterionId: params.criterion_id,
          subscribed: params.subscribed,
        }),
      );
      const result = await runSearch({
        db,
        kind: "post",
        candidates,
        query: checkedQuery(params.query),
        cursor: params.cursor,
        limit: params.limit,
        helper,
      });
      return resultLines(result, (post) => `#${post.id} ${post.title} · author ${post.author}`);
    },
    async skillsSearch(params: Static<typeof S.search>) {
      syncSkillsAndNotify(identity.getDb(), workInput(identity).now);
      const result = await searchSkills({
        db: identity.getDb(),
        ...params,
        query: checkedQuery(params.query),
      });
      return resultLines(
        result,
        (skill) =>
          `${skill.name} r${skill.revision} [${skill.error ? `invalid: ${skill.error}` : "valid"}] ${skill.title} · ${skill.path}`,
      );
    },
    skillsGet({ name }: Static<typeof S.skillsGet>) {
      syncSkillsAndNotify(identity.getDb(), workInput(identity).now);
      const { skill } = identity.getDb().read(() => getSkill(identity.getDb(), name));
      if (!skill) throw new BrokerError("not_found", `Skill ${name} not found.`);
      return `${skill.path} r${skill.revision}${skill.error ? ` · invalid: ${skill.error}` : ""}\nFiles: ${skill.files.join(", ")}\n${skill.content ?? "SKILL.md unavailable"}`;
    },
  };
}
