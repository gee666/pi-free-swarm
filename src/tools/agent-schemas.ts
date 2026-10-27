import { Type } from "typebox";
import { PAGE_MAX_COUNT, SEARCH_MAX_RESULTS_CAP } from "../constants.js";
import { TEXT_MAX, TITLE_MAX } from "../limits.js";

export const text = Type.String({
  minLength: 1,
  pattern: "\\S",
  description: `Keep under ${TEXT_MAX} characters; put longer material in a file and reference its path.`,
});
export const title = Type.String({ minLength: 1, pattern: "\\S", description: `Keep under ${TITLE_MAX} characters.` });
export const id = Type.Integer({ minimum: 1 });
export const empty = Type.Object({}, { additionalProperties: false });
export const byId = Type.Object({ id });
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
  criteria: Type.Array(Type.Object({ criterion_id: id, contribution: text }), { minItems: 1 }),
  depends_on: Type.Optional(Type.Array(id)),
};
export const criteriaSearch = Type.Object({
  ...searchPage,
  status: Type.Optional(Type.Array(criterionStatuses)),
  group: Type.Optional(title),
  task_id: Type.Optional(id),
  author: Type.Optional(text),
  needs_my_vote: Type.Optional(Type.Boolean()),
  include_archived: Type.Optional(Type.Boolean()),
});
export const criteriaCreate = Type.Object(criterionFields);
export const criteriaEdit = Type.Intersect([
  Type.Object({ id, expected_revision: Type.Integer({ minimum: 1 }) }),
  Type.Partial(Type.Object(criterionFields)),
]);
export const criteriaBlock = Type.Object({
  criterion_id: id,
  reason: text,
  missing: text,
  attempted: text,
  unblock: text,
});
export const criteriaVote = Type.Object({
  criterion_id: id,
  verdict: Type.Union([Type.Literal("satisfied"), Type.Literal("incomplete"), Type.Literal("blocked")]),
  reason: text,
});
export const tasksSearch = Type.Object({
  ...searchPage,
  status: Type.Optional(Type.Array(taskStatuses)),
  owner: Type.Optional(text),
  author: Type.Optional(text),
  criterion_id: Type.Optional(id),
  runnable: Type.Optional(Type.Boolean()),
  waiting: Type.Optional(Type.Boolean()),
  mine: Type.Optional(Type.Boolean()),
});
export const tasksGet = Type.Object({ id, ...page });
export const tasksCreate = Type.Object({ ...taskFields, claim: Type.Optional(Type.Boolean()) });
export const tasksEdit = Type.Intersect([
  Type.Object({ id, expected_revision: Type.Integer({ minimum: 1 }) }),
  Type.Partial(Type.Object(taskFields)),
]);
export const tasksHandoff = Type.Object({ id, to: text });
export const tasksTransition = Type.Object({
  id,
  action: Type.Union([Type.Literal("start"), Type.Literal("request_review"), Type.Literal("reopen")]),
  evidence: Type.Optional(text),
  reason: Type.Optional(text),
});
export const tasksReview = Type.Object({
  id,
  verdict: Type.Union([Type.Literal("accept"), Type.Literal("changes")]),
  reason: text,
});
export const postsSearch = Type.Object({
  ...searchPage,
  author: Type.Optional(text),
  task_id: Type.Optional(id),
  criterion_id: Type.Optional(id),
  subscribed: Type.Optional(Type.Boolean()),
});
export const postLinks = { task_ids: Type.Optional(Type.Array(id)), criterion_ids: Type.Optional(Type.Array(id)) };
export const postsCreate = Type.Object({ title, body: text, ...postLinks });
export const postsComment = Type.Object({ post_id: id, body: text });
export const postsLink = Type.Object({ post_id: id, ...postLinks });
export const postId = Type.Object({ post_id: id });
export const messagesSend = Type.Object({ to: text, body: text }, { additionalProperties: false });
export const messagesRead = Type.Object({ with: text, cursor: page.cursor });
export const intentUpdate = Type.Object({ summary: text, path: text });
export const skillsGet = Type.Object({ name: text });
export const paged = Type.Object(page);
export const search = Type.Object(searchPage);
