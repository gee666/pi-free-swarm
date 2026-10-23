import type { RunConfiguration } from "../run-configuration.js";
import type { ConfigurationRequest } from "../runtime-configuration.js";
import { applyRosterConfiguration } from "../store/active-roster.js";
import { appendConfigurationRevision } from "../store/configuration-revisions.js";
import { getRunConfiguration } from "../store/run-configuration.js";
import { seedReplacementPostBaseline } from "../store/replacement-baseline.js";
import { seedReplacementHandoff } from "../store/replacement-handoff.js";
import { readReplacementHandoff } from "./replacement-handoff.js";
import {
  claimConfigurationRequest,
  finishConfigurationRequest,
  listPendingConfigurationRequests,
} from "../store/runtime-configuration.js";
import { listParticipants } from "../store/swarm-queries.js";
import { recordRosterAcceptanceChange } from "./acceptance.js";
import { assertBudgetPricing } from "./budget.js";
import { validateSwarmBudgetRaise } from "./budget-policy.js";
import type { LiveWorkers } from "./live-workers.js";
import type { ReplacementHandoff } from "./run-agent.js";
import type { RunEnvironment } from "./run-types.js";
import { requireIdleWorker } from "./worker-eligibility.js";
import { planWorkerRosterChange } from "./worker-slots.js";

/** Only a claimed current-owner request can cause process effects; uncertainty is never replayed. */
export class RunControls {
  #closed = false;
  #pending: Promise<void> | null = null;
  constructor(
    readonly env: RunEnvironment,
    readonly swarmId: number,
    readonly run: number,
    readonly workers: LiveWorkers,
    readonly canAdd: () => boolean,
  ) {}

  update(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#pending ??= this.#poll().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  quiesce(): void {
    this.#closed = true;
  }

  close(): Promise<void> {
    this.quiesce();
    return this.#pending ?? Promise.resolve();
  }

  async #poll(): Promise<void> {
    const { db } = this.env;
    for (const request of listPendingConfigurationRequests(db, this.swarmId, this.run)) {
      if (this.#closed) return;
      if (request.change.type === "addAgents" && !this.workers.initialReady) return;
      try {
        const claimed = claimConfigurationRequest(db, request.id, this.env.runnerPid, this.env.clock.now());
        if ((claimed.change.type === "addAgents" || claimed.change.type === "retireAgent") && !this.canAdd())
          throw new Error(
            "The run is stopping or its budget is exhausted. Inspect the saved configuration before resuming; this control was not replayed.",
          );
        await this.#apply(claimed);
        finishConfigurationRequest(db, request.id, "applied", null, this.env.clock.now());
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // finish itself fences owner loss. Leave uncertain applying requests intact if that fence fails.
        finishConfigurationRequest(db, request.id, "rejected", reason, this.env.clock.now());
        this.env.notifyUser(`Swarm configuration request #${request.id} was rejected: ${reason}`);
      }
    }
  }

  async #apply(request: ConfigurationRequest): Promise<void> {
    const { db, clock } = this.env;
    const saved = getRunConfiguration(db, this.swarmId, this.run);
    if (!saved) throw new Error("The current run configuration is unavailable.");
    const current = saved.effective;
    const change = request.change;
    if (change.type === "raiseBudget") {
      const patch = {
        ...(change.moneyUsd === undefined ? {} : { moneyUsd: change.moneyUsd }),
        ...(change.timeSeconds === undefined ? {} : { timeSeconds: change.timeSeconds }),
      };
      const budget = validateSwarmBudgetRaise(db, this.swarmId, current.budget, patch);
      appendConfigurationRevision(
        db,
        this.swarmId,
        this.run,
        { ...current, budget },
        request.expectedRevision,
        clock.now(),
      );
      return;
    }
    let handoff: ReplacementHandoff | undefined;
    if (change.type === "retireAgent") {
      requireIdleWorker(db, this.swarmId, change.name);
      handoff = readReplacementHandoff(db, this.swarmId, change.handoffFile);
    }
    const workers = planWorkerRosterChange(
      this.env,
      current.workers,
      change,
      listParticipants(db, this.swarmId).map((participant) => participant.name),
    );
    const added = workers.filter((worker) => !current.workers.some((old) => old.name === worker.name));
    assertBudgetPricing(this.env, new Map(added.map((worker) => [worker.name, worker])), this.swarmId);
    this.workers.validate(added);
    const configuration: RunConfiguration = { ...current, workers };
    db.write(() => {
      applyRosterConfiguration(
        db,
        this.swarmId,
        this.run,
        configuration,
        request.expectedRevision,
        clock.now(),
        this.env.runnerPid,
      );
      recordRosterAcceptanceChange(db, this.swarmId, clock.now(), request.requestedBy);
      if (change.type === "retireAgent") {
        for (const worker of added) {
          seedReplacementPostBaseline(db, this.swarmId, worker.name);
          seedReplacementHandoff(db, this.swarmId, worker.name, change.handoffFile, clock.now());
        }
      }
    });
    const handoffs = new Map<string, ReplacementHandoff>();
    if (handoff) for (const worker of added) handoffs.set(worker.name, handoff);
    try {
      await this.workers.reconcile(handoffs);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `The configuration revision was saved, but worker cleanup or admission failed: ${reason} Inspect the current roster and processes; do not replay this control automatically.`,
        { cause: error },
      );
    }
  }
}
