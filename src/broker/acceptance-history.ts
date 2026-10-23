import { PAGE_DEFAULT_COUNT, PAGE_MAX_COUNT, WATCHER_NAME } from "../constants.js";
import type { AcceptanceHistoryPage } from "../store/acceptance-types.js";
import { acceptanceVoteOf } from "../store/acceptance-queries.js";
import type { SwarmDb } from "../store/db.js";
import { int, text } from "../store/rows.js";
import { BrokerError } from "./errors.js";
import { requireSwarm } from "./validate.js";

interface Position {
  retiredAt: number;
  name: string;
}

function encode(swarmId: number, position: Position): string {
  return Buffer.from(JSON.stringify([1, swarmId, position.retiredAt, position.name])).toString("base64url");
}

function decode(cursor: string, swarmId: number): Position {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(value) &&
      value.length === 4 &&
      value[0] === 1 &&
      value[1] === swarmId &&
      typeof value[2] === "number" &&
      Number.isSafeInteger(value[2]) &&
      value[2] >= 0 &&
      typeof value[3] === "string" &&
      value[3].length > 0
    ) {
      const position = { retiredAt: value[2], name: value[3] };
      if (encode(swarmId, position) === cursor) return position;
    }
  } catch {
    // Invalid cursors never become SQL positions or echo private input.
  }
  throw new BrokerError(
    "validation",
    "after must be a returned history cursor for this swarm; omit it to restart.",
    "after",
  );
}

/** Scan retired rows, not until enough votes appear. New retirements are available on a fresh first page. */
export function readAcceptanceHistory(
  db: SwarmDb,
  swarmId: number,
  options: { count?: number; after?: string } = {},
): AcceptanceHistoryPage {
  requireSwarm(db, swarmId);
  const limit = options.count ?? PAGE_DEFAULT_COUNT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_MAX_COUNT) {
    throw new BrokerError(
      "validation",
      `count must be between 1 and ${PAGE_MAX_COUNT}; omit it for ${PAGE_DEFAULT_COUNT}.`,
      "count",
    );
  }
  const before = options.after === undefined ? null : decode(options.after, swarmId);
  const query = `SELECT p.name AS retired_name, p.retired_at, v.agent, v.run, v.verdict, v.reason,
      v.updated_at AS vote_updated_at FROM participants p
    LEFT JOIN acceptance_votes v ON v.swarm_id = p.swarm_id AND v.agent = p.name
    WHERE p.swarm_id = ? AND p.kind = 'agent' AND p.retired_at IS NOT NULL AND p.name <> ?
      ${before ? "AND (p.retired_at, p.name) < (?, ?)" : ""}
    ORDER BY p.retired_at DESC, p.name DESC LIMIT ?`;
  const statement = db.sql.prepare(query);
  const rows = before
    ? statement.all(swarmId, WATCHER_NAME, before.retiredAt, before.name, limit + 1)
    : statement.all(swarmId, WATCHER_NAME, limit + 1);
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = page[page.length - 1];
  return {
    votes: page.filter((row) => row.agent !== null).map(acceptanceVoteOf),
    scanned: page.length,
    complete: !hasMore,
    next:
      hasMore && last
        ? encode(swarmId, { retiredAt: int(last, "retired_at"), name: text(last, "retired_name") })
        : null,
  };
}
