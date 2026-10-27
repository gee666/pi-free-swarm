import type { SavedRunConfiguration } from "../../../src/run-configuration";

const timingLabels = {
  staggerSeconds: "Worker stagger, seconds",
  idleReminderDelay: "Idle reminder delay, ms",
  heartbeatMs: "Heartbeat, ms",
  deliveryPollMs: "Delivery polling, ms",
  completionCheckMs: "Completion check, ms",
  progressMs: "Progress reporting, ms",
  resumeStaggerMs: "Resume stagger, ms",
  reviveBackoffMs: "Recovery backoff, ms",
  startupTimeoutMs: "Startup watchdog, ms",
  idleTimeoutMs: "Idle watchdog, ms",
  startupRetries: "Startup retries",
};

export function ConfigurationDetails({ configuration }: { configuration?: SavedRunConfiguration | null }) {
  const effective = configuration?.effective;
  return (
    <>
      <h3>Effective run configuration</h3>
      {!effective ? (
        <p>No configuration was recorded for this historical run. Worker assignments are unknown.</p>
      ) : (
        <>
          <p>
            Run {configuration.run} · configuration version {effective.version}
            {(configuration.revision ?? 0) > 0 && ` · runtime revision ${configuration.revision}`}
          </p>
          {configuration.changes.length > 0 && (
            <p>
              {(configuration.revision ?? 0) > 0
                ? `Changed in runtime revision ${configuration.revision}`
                : "Changed on resume"}
              : {configuration.changes.join(", ")}
            </p>
          )}
          <h3>Worker assignments</h3>
          <ul>
            {effective.workers.map((worker) => (
              <li key={worker.name}>
                {worker.name}: {worker.provider}/{worker.modelId} · thinking: {worker.thinkingLevel ?? "unspecified"}
              </li>
            ))}
          </ul>
          <h3>Budget policy</h3>
          <p>
            Money: {effective.budget.moneyUsd === null ? "unlimited" : `$${effective.budget.moneyUsd} USD`} · active
            time: {effective.budget.timeSeconds === null ? "unlimited" : `${effective.budget.timeSeconds} seconds`}
          </p>
          <p>On exhaustion: {effective.budget.gracefulShutdown ? "finish active pi turn" : "interrupt immediately"}.</p>
          <h3>Launch and limits</h3>
          <p>Maximum workers: {effective.limits.maxAgents ?? "not recorded"}</p>
          <p>
            Project trusted: {effective.launch.projectTrusted ? "yes" : "no"} · extensions:{" "}
            {effective.launch.noExtensions ? "disabled" : "enabled"}
          </p>
          <p>Extension arguments: {effective.launch.extensionArgs.join(" ") || "none"}</p>
          <p>RPC frame limit: {effective.limits.maxRpcFrameBytes} bytes</p>
          <h3>Timing</h3>
          <ul>
            {Object.entries(timingLabels).map(([key, label]) => {
              const value = effective.timing[key as keyof typeof timingLabels];
              return (
                <li key={key}>
                  {label}: {Array.isArray(value) ? value.join(", ") : (value ?? "not recorded")}
                </li>
              );
            })}
          </ul>
          <p>Recorded provenance does not guarantee deterministic model behavior.</p>
        </>
      )}
    </>
  );
}
