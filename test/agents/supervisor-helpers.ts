// Records every SupervisorHooks callback of a supervisor that runs against the fake pi.
import type { AgentActivity, ParticipantStatus } from "../../src/api-types.js";
import type { Clock } from "../../src/clock.js";
import { AgentSupervisor, type AgentCrash } from "../../src/agents/supervisor.js";
import type { WatchdogConfig } from "../../src/agents/watchdog.js";
import type { UsageSample } from "../../src/runtime-types.js";
import {
  createFakePiRun,
  useFakePi,
  waitFor,
  type FakePiRun,
  type FakePiScenario,
} from "../fixtures/fake-pi/harness.js";

export const RELAXED_WATCHDOG: WatchdogConfig = { startupTimeoutMs: 10_000, idleTimeoutMs: 10_000, startupRetries: 0 };

export interface Recorded {
  statuses: ParticipantStatus[];
  reads: number[][];
  usage: UsageSample[];
  activity: (AgentActivity | null)[];
  crashes: AgentCrash[];
}

export interface SupervisedAgent {
  supervisor: AgentSupervisor;
  fake: FakePiRun;
  recorded: Recorded;
  waitStatus(status: ParticipantStatus, occurrences?: number): Promise<void>;
  commands(type: string): Record<string, unknown>[];
  cleanup(): Promise<void>;
}

export function superviseFake(
  scenario: FakePiScenario,
  options: { watchdog?: WatchdogConfig; clock?: Clock } = {},
): SupervisedAgent {
  useFakePi();
  const fake = createFakePiRun(scenario);
  const recorded: Recorded = { statuses: [], reads: [], usage: [], activity: [], crashes: [] };
  const supervisor = new AgentSupervisor({
    name: "Maria",
    watchdog: options.watchdog ?? RELAXED_WATCHDOG,
    clock: options.clock,
    hooks: {
      onStatus: (status) => recorded.statuses.push(status),
      onMessagesRead: (ids) => recorded.reads.push(ids),
      onUsage: (sample) => recorded.usage.push(sample),
      onActivity: (activity) => recorded.activity.push(activity),
      onCrash: (crash) => recorded.crashes.push(crash),
    },
  });
  return {
    supervisor,
    fake,
    recorded,
    waitStatus: (status, occurrences = 1) =>
      waitFor(
        () => recorded.statuses.filter((entry) => entry === status).length >= occurrences,
        `status ${status} ×${occurrences} (got ${recorded.statuses.join(", ")})`,
      ),
    commands: (type) => fake.log().filter((record) => record.type === type),
    cleanup: async () => {
      await supervisor.stop();
      fake.cleanup();
    },
  };
}

export function prompt(text: string, messageIds: readonly number[] = []) {
  return { text, messageIds };
}
