import { Type, type TProperties } from "typebox";
import { PAGE_MAX_COUNT, SEARCH_MAX_RESULTS_CAP } from "../constants.js";
import { TEXT_MAX, TITLE_MAX } from "../limits.js";

function object<P extends TProperties>(properties: P) {
  return Type.Object(properties, { additionalProperties: false });
}

export const text = Type.String({
  minLength: 1,
  pattern: "\\S",
  description: `Keep under ${TEXT_MAX} characters; put longer material in a file and reference its path.`,
});
export const title = Type.String({ minLength: 1, pattern: "\\S", description: `Keep under ${TITLE_MAX} characters.` });
export const id = Type.Integer({ minimum: 1 });
export const empty = object({});
export const byId = object({ id });
export const page = {
  cursor: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: PAGE_MAX_COUNT })),
};
export const searchPage = {
  query: Type.Optional(text),
  cursor: page.cursor,
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SEARCH_MAX_RESULTS_CAP })),
};
export const taskStatuses = Type.Union([
  Type.Literal("new"),
  Type.Literal("claimed"),
  Type.Literal("in_progress"),
  Type.Literal("review"),
  Type.Literal("accepted"),
]);
export const criterionStatuses = Type.Union([
  Type.Literal("unlinked"),
  Type.Literal("incomplete"),
  Type.Literal("satisfied"),
  Type.Literal("blocked"),
]);
export const criterionFields = { group: title, title, body: text, verification: text, source: Type.String() };
export const taskFields = {
  title,
  body: text,
  criteria: Type.Array(object({ criterion_id: id, contribution: text }), { minItems: 1 }),
  depends_on: Type.Optional(Type.Array(id)),
};
export const criteriaSearch = object({
  ...searchPage,
  status: Type.Optional(Type.Array(criterionStatuses)),
  group: Type.Optional(title),
  task_id: Type.Optional(id),
  author: Type.Optional(text),
  needs_my_vote: Type.Optional(Type.Boolean()),
  include_archived: Type.Optional(Type.Boolean()),
});
export const criteriaCreate = object(criterionFields);
export const criteriaEdit = object({
  id,
  expected_revision: Type.Integer({ minimum: 1 }),
  ...Type.Partial(object(criterionFields)).properties,
});
export const criteriaBlock = object({
  criterion_id: id,
  reason: text,
  missing: text,
  attempted: text,
  unblock: text,
});
export const criteriaVote = object({
  criterion_id: id,
  verdict: Type.Union([
    Type.Literal("covered", { description: "linked tasks, when done, fully satisfy the criterion" }),
    Type.Literal("gap", { description: "something is missing — say what, or add/link a task" }),
    Type.Literal("blocked", { description: "an external limitation the swarm cannot resolve" }),
  ]),
  reason: Type.String({
    ...text,
    description: `For gap, name the missing part. Keep under ${TEXT_MAX} characters; put longer material in a file and reference its path.`,
  }),
});
export const tasksSearch = object({
  ...searchPage,
  status: Type.Optional(Type.Array(taskStatuses)),
  owner: Type.Optional(text),
  author: Type.Optional(text),
  criterion_id: Type.Optional(id),
  runnable: Type.Optional(Type.Boolean()),
  waiting: Type.Optional(Type.Boolean()),
  mine: Type.Optional(Type.Boolean()),
});
export const tasksGet = object({ id, ...page });
export const tasksCreate = object({ ...taskFields, claim: Type.Optional(Type.Boolean()) });
export const tasksEdit = object({
  id,
  expected_revision: Type.Integer({ minimum: 1 }),
  ...Type.Partial(object(taskFields)).properties,
});
export const tasksHandoff = object({ id, to: text });
export const tasksTransition = object({
  id,
  action: Type.Union([Type.Literal("start"), Type.Literal("reopen")]),
  reason: Type.Optional(text),
});
export const postsSearch = object({
  ...searchPage,
  author: Type.Optional(text),
  task_id: Type.Optional(id),
  criterion_id: Type.Optional(id),
  subscribed: Type.Optional(Type.Boolean()),
});
export const postLinks = { task_ids: Type.Optional(Type.Array(id)), criterion_ids: Type.Optional(Type.Array(id)) };
export const postsCreate = object({ title, body: text, ...postLinks });
export const postsComment = object({ post_id: id, body: text });
export const postsLink = object({ post_id: id, ...postLinks });
export const postId = object({ post_id: id });
export const messagesSend = object({ to: text, body: text });
export const messagesRead = object({ with: text, cursor: page.cursor });
export const intentUpdate = object({ summary: text, path: text });
export const skillsGet = object({ name: text });
export const paged = object(page);
export const search = object(searchPage);
