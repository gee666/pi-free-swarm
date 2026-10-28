import type { Static } from "typebox";
import * as S from "./agent-schemas.js";
import { checkedQuery, workInput, type AgentToolIdentity } from "./agent-tool-context.js";
import { searchCriterionCandidates, searchTaskCandidates } from "../broker/work-queries.js";
import { taskListRecords } from "../store/task-list.js";
import { criterionStates } from "../store/work-state.js";
import { listCriteria } from "../store/criteria.js";
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
      const candidates = db.read(() => {
        const tasks = new Map(taskListRecords(db, identity.swarmId).map((task) => [task.id, task]));
        return searchTaskCandidates(db, identity.swarmId, identity.agentName, {
          status: params.status,
          owner: params.owner,
          author: params.author,
          criterionId: params.criterion_id,
          runnable: params.runnable,
          waiting: params.waiting,
          mine: params.mine,
        }).map((candidate) => {
          const task = tasks.get(candidate.id);
          if (task === undefined) throw new Error(`Missing task #${candidate.id}.`);
          return { ...candidate, id: String(candidate.id), line: taskLine(task) };
        });
      });
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
      const candidates = db.read(() => {
        const states = new Map(criterionStates(db, identity.swarmId, true).map((state) => [state.id, state.status]));
        const criteria = new Map(
          listCriteria(db, identity.swarmId, true).map((criterion) => [criterion.id, criterion]),
        );
        return searchCriterionCandidates(db, identity.swarmId, identity.agentName, {
          status: params.status,
          group: params.group,
          taskId: params.task_id,
          author: params.author,
          needsMyVote: params.needs_my_vote,
          includeArchived: params.include_archived,
        }).map((candidate) => {
          const criterion = criteria.get(candidate.id);
          const status = states.get(candidate.id);
          if (criterion === undefined || status === undefined) throw new Error(`Missing criterion #${candidate.id}.`);
          return { ...candidate, id: String(candidate.id), detail: { ...criterion, status } };
        });
      });
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
