import { useRef, useState } from "react";
import type { SavedRunConfiguration } from "../../../src/run-configuration";
import { Popover } from "./Popover";
import styles from "./AcceptanceSummary.module.css";

const timingLabels = {
  staggerSeconds: "Worker stagger, seconds",
  idleReminderDelay: "Idle reminder delay, ms",
  idleReminderDigestSize: "Fresh posts per reminder",
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

export function RunConfiguration({ configuration }: { configuration?: SavedRunConfiguration | null }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const effective = configuration?.effective;
  return (
    <>
      <button ref={anchor} className={styles.pill} aria-expanded={open} onClick={() => setOpen(!open)}>
        Run configuration
      </button>
      <Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)} align="end" className={styles.summary}>
        <h3>Effective run configuration</h3>
        {!effective ? (
          <p>No configuration was recorded for this historical run. Worker assignments are unknown.</p>
        ) : (
          <>
            <p>
              Run {configuration.run} · configuration version {effective.version}
            </p>
            {configuration.changes.length > 0 && <p>Changed on resume: {configuration.changes.join(", ")}</p>}
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
            <p>
              On exhaustion: {effective.budget.gracefulShutdown ? "finish active pi turn" : "interrupt immediately"}.
            </p>
            <h3>Launch and limits</h3>
            <p>
              Project trusted: {effective.launch.projectTrusted ? "yes" : "no"} · extensions:{" "}
              {effective.launch.noExtensions ? "disabled" : "enabled"}
            </p>
            <p>Extension arguments: {effective.launch.extensionArgs.join(" ") || "none"}</p>
            <p>
              Body limit: {effective.limits.bodyMaxChars} characters · RPC frame limit:{" "}
              {effective.limits.maxRpcFrameBytes} bytes
            </p>
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
      </Popover>
    </>
  );
}
