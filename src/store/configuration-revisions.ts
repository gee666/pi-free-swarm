import type { RunConfiguration, SavedRunConfiguration } from "../run-configuration.js";
import type { SwarmDb } from "./db.js";
import { changedSections, getRunConfiguration, projectRunConfiguration } from "./run-configuration.js";

export class ConfigurationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationConflictError";
  }
}

export function getConfigurationRevision(db: SwarmDb, swarmId: number, run?: number): number {
  return getRunConfiguration(db, swarmId, run)?.revision ?? 0;
}

/** The caller joins its state/outbox write around this append; initial run provenance is never rewritten. */
export function appendConfigurationRevision(
  db: SwarmDb,
  swarmId: number,
  run: number,
  configuration: RunConfiguration,
  expectedRevision: number,
  now: number,
): SavedRunConfiguration {
  return db.write(({ sql }) => {
    const swarm = sql.prepare("SELECT run_count FROM swarms WHERE id = ?").get(swarmId);
    if (!swarm || Number(swarm.run_count) !== run) {
      throw new ConfigurationConflictError("The swarm run changed. Refresh configuration before editing.");
    }
    const previous = getRunConfiguration(db, swarmId, run);
    if (!previous) throw new ConfigurationConflictError("This run has no recorded configuration to edit.");
    const currentRevision = previous.revision ?? 0;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== currentRevision) {
      throw new ConfigurationConflictError(
        `Configuration revision changed to ${currentRevision}. Refresh before editing.`,
      );
    }
    const effective = projectRunConfiguration(configuration);
    const changes = changedSections(previous.effective, effective);
    const revision = currentRevision + 1;
    sql
      .prepare(
        "INSERT INTO run_configuration_revisions (swarm_id, run, revision, recorded_at, configuration, changes) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(swarmId, run, revision, now, JSON.stringify(effective), JSON.stringify(changes));
    return { run, revision, recordedAt: now, effective, changes };
  });
}
