// The one SQLite handle per process. node:sqlite is synchronous, so a transaction can never span an await.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BUSY_TIMEOUT_MS, DB_FILE, SESSION_FILE, SESSIONS_DIR, SWARM_DIR } from "../constants.js";

export interface SwarmDb {
  /** Absolute path of swarm.db. */
  readonly path: string;
  /** `dirname(path)` = `<project>/.pi/swarm`. */
  readonly dataDir: string;
  readonly sql: DatabaseSync;
  /** BEGIN IMMEDIATE … COMMIT, ROLLBACK on throw. Reentrant: nested calls join the outer transaction. */
  write<T>(fn: () => T): T;
  close(): void;
}

/** Each file is applied once, in order, inside the transaction that bumps `user_version` to its version. */
const MIGRATIONS: readonly { version: number; file: string }[] = [{ version: 1, file: "schema.sql" }];
const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

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

  const sql = new DatabaseSync(absolute);
  // busy_timeout first: switching to WAL needs a lock another process may hold.
  sql.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  sql.exec("PRAGMA journal_mode = WAL");
  sql.exec("PRAGMA foreign_keys = ON");
  sql.exec("PRAGMA synchronous = NORMAL");

  let depth = 0;
  const db: SwarmDb = {
    path: absolute,
    dataDir: path.dirname(absolute),
    sql,
    write<T>(fn: () => T): T {
      if (depth > 0) return assertSync(fn());
      sql.exec("BEGIN IMMEDIATE");
      depth++;
      try {
        const result = assertSync(fn());
        sql.exec("COMMIT");
        return result;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      } finally {
        depth--;
      }
    },
    close: () => sql.close(),
  };
  try {
    migrate(db);
  } catch (error) {
    sql.close();
    throw error;
  }
  return db;
}

function migrate(db: SwarmDb): void {
  if (userVersion(db) === LATEST_VERSION) return;
  db.write(() => {
    // Re-read under the write lock: another process may have migrated since the first check.
    const current = userVersion(db);
    if (current > LATEST_VERSION) {
      throw new Error(
        `${DB_FILE} schema v${current} is newer than this extension (v${LATEST_VERSION}). Update pi-free-swarm.`,
      );
    }
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      db.sql.exec(readFileSync(new URL(migration.file, import.meta.url), "utf8"));
    }
    db.sql.exec(`PRAGMA user_version = ${LATEST_VERSION}`);
  });
}

function userVersion(db: SwarmDb): number {
  const row = db.sql.prepare("PRAGMA user_version").get();
  return Number(row?.user_version ?? 0);
}

function assertSync<T>(result: T): T {
  if (typeof result === "object" && result !== null && "then" in result && typeof result.then === "function") {
    throw new Error("db.write callback must be synchronous");
  }
  return result;
}
