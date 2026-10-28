// Both runtimes use synchronous SQLite; a transaction can never span an await.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync, SQLInputValue, SQLOutputValue, StatementSync } from "node:sqlite";
import { BUSY_TIMEOUT_MS, DB_FILE, SESSION_FILE, SESSIONS_DIR, SWARM_DIR } from "../constants.js";

type Statement = {
  all(...params: SQLInputValue[]): ReturnType<StatementSync["all"]>;
  get(...params: SQLInputValue[]): ReturnType<StatementSync["get"]>;
  run(...params: SQLInputValue[]): ReturnType<StatementSync["run"]>;
};
type SqlDatabase = Pick<DatabaseSync, "exec" | "close" | "isTransaction"> & {
  prepare(query: string): Statement;
  function(name: string, fn: (...args: SQLOutputValue[]) => SQLInputValue): void;
};
type BunDatabase = Pick<SqlDatabase, "exec" | "close" | "function"> & {
  readonly inTransaction: boolean;
  prepare(query: string): Pick<Statement, "all" | "run"> & {
    get(...params: SQLInputValue[]): Record<string, SQLOutputValue> | null;
  };
};

function openSqlite(file: string): SqlDatabase {
  const require = createRequire(import.meta.url);
  if (!process.versions.bun) {
    const { DatabaseSync }: typeof import("node:sqlite") = require("node:sqlite");
    return new DatabaseSync(file);
  }
  const { Database }: { Database: new (file: string) => BunDatabase } = require("bun:sqlite");
  const db = new Database(file);
  return {
    exec: (query) => db.exec(query),
    close: () => db.close(),
    function: (name, fn) => db.function(name, fn),
    get isTransaction() {
      return db.inTransaction;
    },
    prepare(query) {
      const statement = db.prepare(query);
      return {
        all: (...params) => statement.all(...params),
        run: (...params) => statement.run(...params),
        // Store queries distinguish missing rows from SQL NULL column values.
        get: (...params: SQLInputValue[]) => statement.get(...params) ?? undefined,
      };
    },
  };
}

/** SQL access scoped to a synchronous state-plus-outbox mutation. */
export interface WriteTransaction {
  readonly sql: SqlDatabase;
}

export interface SwarmDb {
  /** Absolute path of swarm.db. */
  readonly path: string;
  /** `dirname(path)` = `<project>/.pi/swarm`. */
  readonly dataDir: string;
  readonly sql: SqlDatabase;
  /** BEGIN IMMEDIATE … COMMIT, ROLLBACK on throw. Reentrant: nested calls join the outer transaction. */
  write<T>(fn: (transaction: WriteTransaction) => T): T;
  /** Keep multi-query reads on one WAL snapshot without blocking writers. */
  read<T>(fn: () => T): T;
  afterCommit(callback: () => void): void;
  close(): void;
}

/** Each file is applied once, in order, inside the transaction that bumps `user_version` to its version. */
const MIGRATIONS: readonly { version: number; file: string }[] = [
  { version: 1, file: "schema.sql" },
  { version: 2, file: "002-communication.sql" },
  { version: 3, file: "acceptance.sql" },
  { version: 4, file: "004-acceptance-votes.sql" },
  { version: 5, file: "005-event-retention.sql" },
  { version: 6, file: "006-wall-coverage.sql" },
  { version: 7, file: "007-run-configuration.sql" },
  { version: 8, file: "008-subscriptions.sql" },
  { version: 9, file: "009-budget.sql" },
  { version: 10, file: "010-budget-accounting.sql" },
  { version: 11, file: "011-reminder-snooze.sql" },
  { version: 12, file: "012-runtime-configuration.sql" },
  { version: 13, file: "013-usage-cost-breakdown.sql" },
  { version: 14, file: "014-usage-provenance.sql" },
  { version: 15, file: "015-user-comment-attention.sql" },
  { version: 16, file: "016-post-claims.sql" },
  { version: 17, file: "017-post-contracts.sql" },
  { version: 18, file: "018-work-graph.sql" },
  { version: 19, file: "019-search-skills.sql" },
  { version: 20, file: "020-review-subagent.sql" },
  { version: 21, file: "021-wall-notifications.sql" },
];
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function swarmDataDir(cwd: string): string {
  return path.join(path.resolve(cwd), SWARM_DIR);
}

export function swarmDbPath(cwd: string): string {
  return path.join(swarmDataDir(cwd), DB_FILE);
}

export function hasSwarmDb(cwd: string): boolean {
  return existsSync(swarmDbPath(cwd));
}

/** The single place that builds an agent's session path; the DB stores it relative to `dataDir`. */
export function agentSessionFile(dataDir: string, swarmId: number, name: string): string {
  return path.join(dataDir, SESSIONS_DIR, String(swarmId), name, SESSION_FILE);
}

export function openSwarmDb(dbPath: string, options: { create: boolean }): SwarmDb {
  const absolute = path.resolve(dbPath);
  if (options.create) mkdirSync(path.dirname(absolute), { recursive: true });
  else if (!existsSync(absolute)) throw new Error(`Swarm database not found: ${absolute}`);

  const sql = openSqlite(absolute);
  // busy_timeout first: switching to WAL needs a lock another process may hold.
  sql.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  sql.exec("PRAGMA journal_mode = WAL");
  sql.exec("PRAGMA foreign_keys = ON");
  sql.exec("PRAGMA synchronous = NORMAL");

  let depth = 0;
  let afterCommit: (() => void)[] = [];
  const db: SwarmDb = {
    path: absolute,
    dataDir: path.dirname(absolute),
    sql,
    read: (fn) => transact("BEGIN", "read", fn),
    write: (fn) => transact("BEGIN IMMEDIATE", "write", () => fn({ sql })),
    afterCommit(callback) {
      if (depth === 0) callback();
      else afterCommit.push(callback);
    },
    close: () => sql.close(),
  };
  function transact<T>(begin: string, operation: string, fn: () => T): T {
    if (depth > 0) return assertSync(fn(), operation);
    sql.exec(begin);
    depth++;
    let result: T;
    try {
      result = assertSync(fn(), operation);
      sql.exec("COMMIT");
    } catch (error) {
      sql.exec("ROLLBACK");
      afterCommit = [];
      throw error;
    } finally {
      depth--;
    }
    const committed = afterCommit;
    afterCommit = [];
    for (const callback of committed) callback();
    return result;
  }
  try {
    migrate(db);
  } catch (error) {
    sql.close();
    throw error;
  }
  return db;
}

function migrate(db: SwarmDb): void {
  if (userVersion(db) === SCHEMA_VERSION) return;
  db.sql.exec("PRAGMA foreign_keys = OFF");
  try {
    db.write(() => {
      // Re-read under the write lock: another process may have migrated since the first check.
      const current = userVersion(db);
      if (current > SCHEMA_VERSION) {
        throw new Error(
          `${DB_FILE} schema v${current} is newer than this extension (v${SCHEMA_VERSION}). Update pi-free-swarm.`,
        );
      }
      for (const migration of MIGRATIONS) {
        if (migration.version <= current) continue;
        db.sql.exec(readFileSync(new URL(migration.file, import.meta.url), "utf8"));
      }
      if (db.sql.prepare("PRAGMA foreign_key_check").all().length > 0) {
        throw new Error("Schema migration would violate foreign keys");
      }
      db.sql.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  } finally {
    db.sql.exec("PRAGMA foreign_keys = ON");
  }
}

function userVersion(db: SwarmDb): number {
  const row = db.sql.prepare("PRAGMA user_version").get();
  return Number(row?.user_version ?? 0);
}

function assertSync<T>(result: T, operation: string): T {
  if (typeof result === "object" && result !== null && "then" in result && typeof result.then === "function") {
    throw new Error(`db.${operation} callback must be synchronous`);
  }
  return result;
}
