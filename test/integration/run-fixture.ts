// A swarm run against the fake pi with every delay shrunk: temp project, DB, settings snapshot and probes.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ParticipantStatus, RecipientStatus } from "../../src/api-types.js";
import type { RunProgress } from "../../src/broker/run-progress.js";
import type { RunEnvironment, RunTimings } from "../../src/broker/swarm-run.js";
import { systemClock } from "../../src/clock.js";
import type { SwarmSettings } from "../../src/settings.js";
import { openSwarmDb, swarmDbPath, type SwarmDb } from "../../src/store/db.js";
import { getMessages } from "../../src/store/message-queries.js";
import { getParticipant, listAgentSessions, listSwarms } from "../../src/store/swarm-queries.js";
import { createFakePiRun, useFakePi, type FakePiRun, type FakePiScenario } from "../fixtures/fake-pi/harness.js";

export { waitFor } from "../fixtures/fake-pi/harness.js";

useFakePi();

export const FAST: RunTimings = {
  heartbeatMs: 200,
  deliveryPollMs: 50,
  completionCheckMs: 25,
  completionGraceMs: 300,
  progressMs: 50,
  resumeStaggerMs: 50,
  reviveBackoffMs: [40, 40, 40],
  watchdog: { startupTimeoutMs: 10_000, idleTimeoutMs: 60_000, startupRetries: 0 },
};

export const BOARD_URL = "http://127.0.0.1:3999";

export interface RunFixture {
  cwd: string;
  db: SwarmDb;
  fake: FakePiRun;
  env: RunEnvironment;
  notes: string[];
  progress: RunProgress[];
  cleanup(): void;
}

export function createRunFixture(
  scenario: FakePiScenario,
  options: { staggerSeconds?: number; timings?: Partial<RunTimings>; settingsEnv?: Record<string, string> } = {},
): RunFixture {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-free-swarm-run-"));
  const db = openSwarmDb(swarmDbPath(cwd), { create: true });
  const fake = createFakePiRun(scenario);
  const settings: SwarmSettings = {
    port: null,
    minAgents: 1,
    maxAgents: 10,
    defaultAgents: 2,
    staggerSeconds: options.staggerSeconds ?? 0,
    env: { ...fake.env, ...options.settingsEnv },
  };
  const notes: string[] = [];
  const env: RunEnvironment = {
    cwd,
    db,
    runnerPid: process.pid,
    clock: systemClock,
    settings,
    launch: { extensionArgs: [], projectTrusted: false, model: null },
    boardUrl: () => BOARD_URL,
    notifyUser: (text) => notes.push(text),
    timings: { ...FAST, ...options.timings },
  };
  return {
    cwd,
    db,
    fake,
    env,
    notes,
    progress: [],
    cleanup() {
      db.close();
      fake.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

/** The swarm a startSwarm call just created (it is written before the first await). */
export function newestSwarmId(db: SwarmDb): number {
  const swarm = listSwarms(db, Date.now())[0];
  if (!swarm) throw new Error("No swarm was created.");
  return swarm.id;
}

export function agentNames(db: SwarmDb, swarmId: number): string[] {
  return listAgentSessions(db, swarmId).map((agent) => agent.name);
}

export function agentStatus(db: SwarmDb, swarmId: number, name: string): ParticipantStatus | null {
  const participant = getParticipant(db, swarmId, name);
  return participant?.kind === "agent" ? participant.status : null;
}

export function reviveCount(db: SwarmDb, swarmId: number, name: string): number {
  const participant = getParticipant(db, swarmId, name);
  return participant?.kind === "agent" ? participant.reviveCount : -1;
}

export function recipientStatus(db: SwarmDb, messageId: number, name: string): RecipientStatus | undefined {
  return getMessages(db, [messageId])[0]?.recipients.find((recipient) => recipient.name === name)?.status;
}

/** Texts of every `prompt` command the fake received, in order. */
export function promptTexts(fake: FakePiRun): string[] {
  return fake
    .log()
    .filter((record) => record.type === "prompt")
    .map((record) => String(record.message));
}

export interface FakeSpawn {
  pid: number;
  session: string | undefined;
}

export function spawnsOf(fake: FakePiRun): FakeSpawn[] {
  return fake
    .log()
    .filter((record) => record.fake === "spawn")
    .map((record) => {
      const argv = Array.isArray(record.argv) ? record.argv.map(String) : [];
      const index = argv.indexOf("--session");
      return { pid: Number(record.pid), session: index >= 0 ? argv[index + 1] : undefined };
    });
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Texts of the System replies in a thread. */
export function systemReplies(db: SwarmDb, threadId: number): string[] {
  return db.sql
    .prepare("SELECT body FROM messages WHERE thread_id = ? AND sender = 'System' ORDER BY id")
    .all(threadId)
    .map((row) => String(row.body));
}
