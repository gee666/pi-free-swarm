import type { AgentCrash } from "../agents/supervisor.js";
import { WATCHER_NAME } from "../constants.js";
import type { WorkerAssignment } from "../run-configuration.js";
import { getActiveAssignments } from "../store/active-roster.js";
import { listAgentSessions } from "../store/swarm-queries.js";
import { getPendingReplacementHandoff } from "../store/replacement-handoff.js";
import { readReplacementHandoff } from "./replacement-handoff.js";
import { setAgentStatus } from "./agent-state.js";
import { RunAgent, type ReplacementHandoff } from "./run-agent.js";
import type { runAgentFactory } from "./run-agent-factory.js";
import { RunResources } from "./run-resources.js";
import type { RunEnvironment } from "./run-types.js";
import { StartupAdmission } from "./startup-admission.js";

export interface LiveWorkerServices {
  create: ReturnType<typeof runAgentFactory>;
  launch(agent: RunAgent): void;
  removed(agent: RunAgent): void;
  changed(): void;
  canContinue(): boolean;
  onError(error: unknown): void;
}

/** Live edits share the existing agent map and transport, without replacing healthy workers. */
export class LiveWorkers {
  readonly #knownReady = new Set<string>();
  readonly #initialPending: Set<string>;
  readonly #retiring = new Map<string, RunAgent>();
  readonly #releases = new Map<string, () => void>();
  readonly #groups = new Map<string, StartupAdmission>();
  readonly #failedGroups = new Map<string, string>();
  #closed = false;

  constructor(
    readonly env: RunEnvironment,
    readonly swarmId: number,
    readonly agents: Map<string, RunAgent>,
    readonly resources: RunResources,
    readonly services: LiveWorkerServices,
  ) {
    this.#initialPending = new Set([...agents.keys()].filter((name) => name !== WATCHER_NAME));
  }

  get initialReady(): boolean {
    return this.#initialPending.size === 0;
  }

  register(agent: RunAgent): void {
    if (!this.#releases.has(agent.name))
      this.#releases.set(
        agent.name,
        this.resources.add("join", () => agent.stop()),
      );
  }

  ready(agent: RunAgent): void {
    this.#initialPending.delete(agent.name);
    this.#failedGroups.delete(agent.launchKey);
    this.#knownReady.add(agent.launchKey);
    this.#groups.get(agent.launchKey)?.ready(agent);
  }

  crashed(agent: RunAgent, crash: AgentCrash): boolean {
    return this.#groups.get(agent.launchKey)?.crashed(agent, crash) ?? false;
  }

  isolatedFailure(agent: RunAgent): void {
    this.#initialPending.delete(agent.name);
    this.#groups.get(agent.launchKey)?.isolatedFailure(agent);
  }

  validate(added: readonly WorkerAssignment[]): void {
    for (const assignment of added) {
      const key = this.services.create({ name: assignment.name, sessionFile: "" }, assignment).launchKey;
      const failure = this.#failedGroups.get(key);
      if (failure)
        throw new Error(
          `This launch configuration already failed startup: ${failure}. Fix it before a new run or resume.`,
        );
    }
  }

  async reconcile(handoffs: ReadonlyMap<string, ReplacementHandoff> = new Map()): Promise<void> {
    if (this.#closed) return;
    const assignments = getActiveAssignments(this.env.db, this.swarmId);
    const desired = new Set(assignments.map((worker) => worker.name));
    for (const [name, agent] of this.agents) {
      if (name === WATCHER_NAME || desired.has(name)) continue;
      this.agents.delete(name);
      this.#retiring.set(name, agent);
    }
    const stopped = await Promise.allSettled(
      [...this.#retiring].map(async ([name, agent]) => {
        await agent.stop();
        this.#initialPending.delete(name);
        this.#groups.get(agent.launchKey)?.remove(agent);
        this.services.removed(agent);
        this.#releases.get(name)?.();
        this.#releases.delete(name);
        this.#retiring.delete(name);
      }),
    );
    const failures = stopped.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    if (failures.length) throw new AggregateError(failures, "Removed worker cleanup did not complete.");
    if (this.#closed || !this.services.canContinue()) return;
    const sessions = new Map(
      listAgentSessions(this.env.db, this.swarmId, { activeOnly: true }).map((session) => [session.name, session]),
    );
    for (const assignment of assignments) {
      if (this.agents.has(assignment.name)) continue;
      const session = sessions.get(assignment.name);
      if (!session) throw new Error(`Missing durable session for worker ${assignment.name}.`);
      const savedHandoff = getPendingReplacementHandoff(this.env.db, this.swarmId, assignment.name);
      const handoff =
        handoffs.get(assignment.name) ??
        (savedHandoff ? readReplacementHandoff(this.env.db, this.swarmId, savedHandoff) : undefined);
      const agent = this.services.create(session, assignment, handoff);
      this.agents.set(agent.name, agent);
      this.register(agent);
      try {
        agent.writeSystemPrompt();
        this.#admit(agent);
      } catch (error) {
        await agent.stop();
        setAgentStatus(this.env.db, this.swarmId, agent.name, "crashed", this.env.clock.now());
        throw error;
      }
    }
    this.services.changed();
  }

  #admit(agent: RunAgent): void {
    if (this.#closed || !this.services.canContinue()) return;
    if (this.#knownReady.has(agent.launchKey)) {
      this.services.launch(agent);
      return;
    }
    let admission = this.#groups.get(agent.launchKey);
    if (!admission) {
      const key = agent.launchKey;
      admission = new StartupAdmission(
        (candidate) => {
          const current = this.agents.get(candidate.name);
          if (current && !this.#closed && this.services.canContinue()) this.services.launch(current);
        },
        (error) => this.#startupFailed(key, error),
      );
      this.#groups.set(agent.launchKey, admission);
    }
    admission.admit(agent);
  }

  #startupFailed(key: string, error: Error): void {
    this.#failedGroups.set(key, error.message);
    this.env.notifyUser(`Live worker admission failed: ${error.message}. Healthy unrelated workers continue.`);
    const pending = Promise.all(
      [...this.agents.values()]
        .filter((agent) => agent.launchKey === key && (agent.status === "pending" || agent.status === "starting"))
        .map(async (agent) => {
          await agent.stop();
          setAgentStatus(this.env.db, this.swarmId, agent.name, "crashed", this.env.clock.now());
        }),
    ).then(() => undefined);
    this.resources.add("join", () => pending);
    void pending.catch(this.services.onError);
  }

  close(): void {
    this.#closed = true;
    for (const admission of this.#groups.values()) admission.close();
  }
}
